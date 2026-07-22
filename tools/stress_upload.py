"""
BLE upload stress test for the MiniR4 runtime.

Uploads synthetic bytecode of varying sizes to characterize the CMD_START
size-cap behavior and measure upload throughput near the ceiling.

Usage:
    python stress_upload.py --sizes 6144,6145,7000
    python stress_upload.py --sweep       # 500-byte steps from 5500 to 7000
    python stress_upload.py --name MATRIX-R4-Runtime

Each size is uploaded fresh (previous program wiped via CMD_ERASE) so a
rejection doesn't corrupt the next attempt. RUN is issued only for the
first accepted upload -- we want to characterize the upload path, not
runtime crashes from garbage bytecode.

Synthetic program layout:
    - N-1 bytes of NOP (0x00) opcode -- the VM treats unknown opcodes as
      an error, so we use HALT (0x01) as filler once, then padding. But
      the simplest safe payload is: all HALT bytes. The VM stops at the
      first byte. Program size still fills to N. Upload path is what's
      being tested, not execution logic.
"""

import argparse
import asyncio
import struct
import sys
import time
from typing import Optional

from bleak import BleakClient, BleakScanner

NUS_RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
NUS_TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

CMD_START, CMD_CHUNK, CMD_END = 0x01, 0x02, 0x03
CMD_RUN, CMD_STOP, CMD_ERASE  = 0x04, 0x05, 0x06
CMD_INFO                      = 0x07
RSP_ACK, RSP_STATE            = 0xA0, 0xA1

CHUNK_SIZE = 60


def synth_program(n: int) -> bytes:
    """
    Build an N-byte payload safe to upload. First byte is HALT so if it
    ever executes, the VM stops cleanly. Rest is filler that never runs.
    """
    if n < 1:
        return b""
    return bytes([0x01]) + b"\x00" * (n - 1)


class Client:
    def __init__(self, ble: BleakClient):
        self.ble = ble
        self._pending: Optional[asyncio.Future] = None

    def _on_notify(self, _sender, data: bytearray) -> None:
        if not data or data[0] != RSP_ACK or len(data) < 3:
            return
        if self._pending and not self._pending.done():
            self._pending.set_result((data[1], data[2]))

    async def start(self) -> None:
        await self.ble.start_notify(NUS_TX_UUID, self._on_notify)

    async def _send(self, cmd: int, payload: bytes = b"", timeout: float = 3.0):
        self._pending = asyncio.get_running_loop().create_future()
        frame = bytes([cmd]) + payload
        t0 = time.perf_counter()
        await self.ble.write_gatt_char(NUS_RX_UUID, frame, response=True)
        try:
            cmd_r, status = await asyncio.wait_for(self._pending, timeout=timeout)
        except asyncio.TimeoutError:
            return (cmd, 0xFF, (time.perf_counter() - t0) * 1000, True)
        return (cmd_r, status, (time.perf_counter() - t0) * 1000, False)

    async def upload(self, code: bytes) -> dict:
        """Return dict with per-step status. Never asserts."""
        size = len(code)
        result = dict(size=size, start=None, chunks_ok=0, chunks_fail=0,
                      end=None, total_ms=None, first_bad_status=None)
        t0 = time.perf_counter()

        cmd, status, ms, timed_out = await self._send(CMD_START, struct.pack("<H", size))
        result["start"] = dict(status=status, ms=ms, timed_out=timed_out)
        if timed_out or status != 0:
            result["first_bad_status"] = status
            result["total_ms"] = (time.perf_counter() - t0) * 1000
            return result

        for i in range(0, size, CHUNK_SIZE):
            chunk = code[i:i + CHUNK_SIZE]
            cmd, status, ms, timed_out = await self._send(CMD_CHUNK, chunk)
            if timed_out or status != 0:
                result["chunks_fail"] += 1
                if result["first_bad_status"] is None:
                    result["first_bad_status"] = status
                break
            result["chunks_ok"] += 1

        cmd, status, ms, timed_out = await self._send(CMD_END)
        result["end"] = dict(status=status, ms=ms, timed_out=timed_out)
        result["total_ms"] = (time.perf_counter() - t0) * 1000
        return result

    async def erase(self) -> tuple[int, float]:
        cmd, status, ms, _ = await self._send(CMD_ERASE)
        return status, ms


async def run(name: str, sizes: list[int]) -> int:
    print(f"Scanning for {name} (10s)...")
    dev = await BleakScanner.find_device_by_name(name, timeout=10.0)
    if dev is None:
        print(f"NOT FOUND: {name}")
        return 1
    print(f"Found {dev.name} @ {dev.address}")

    async with BleakClient(dev) as ble:
        print(f"Connected. MTU={ble.mtu_size}")
        c = Client(ble)
        await c.start()

        # Wipe any leftover program so we start clean.
        st, ms = await c.erase()
        print(f"ERASE status={st} {ms:.0f}ms\n")

        print(f"{'size':>6}  {'START':>10}  {'CHUNKS ok/fail':>18}  {'END':>10}  {'total':>10}  verdict")
        print("-" * 90)
        for n in sizes:
            code = synth_program(n)
            r = await c.upload(code)

            start_ok = r["start"] and r["start"]["status"] == 0 and not r["start"]["timed_out"]
            end_ok = r["end"] and r["end"]["status"] == 0 and not r["end"]["timed_out"]
            start_str = f"st={r['start']['status']:>3} {r['start']['ms']:.0f}ms" if r["start"] else "-"
            end_str   = f"st={r['end']['status']:>3} {r['end']['ms']:.0f}ms" if r["end"] else "-"
            verdict = "ACCEPTED" if (start_ok and end_ok and r["chunks_fail"] == 0) else "REJECTED"

            print(f"{n:>6}  {start_str:>10}  {r['chunks_ok']:>7}/{r['chunks_fail']:<8}  {end_str:>10}  {r['total_ms']:>7.0f}ms  {verdict}")

            # Clean up before next test so a persisted oversized doesn't
            # confuse the next boot. (ERASE is a no-op if nothing stored.)
            await c.erase()
            await asyncio.sleep(0.2)

    print("\nDone.")
    return 0


def parse_sizes(s: str) -> list[int]:
    if s == "sweep":
        return list(range(5500, 8001, 250))
    return [int(x) for x in s.split(",")]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="MATRIX-R4-Runtime")
    ap.add_argument("--sizes", default="6144,6145,6500,7000,8000")
    args = ap.parse_args()

    sizes = parse_sizes(args.sizes)
    return asyncio.run(run(args.name, sizes))


if __name__ == "__main__":
    sys.exit(main())
