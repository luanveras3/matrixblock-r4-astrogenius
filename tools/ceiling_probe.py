"""
Single-shot ceiling probe. Used for Phase 2 sweep:
  1. Connect
  2. CMD_INFO -> read RSP_STATE (now includes freeRam)
  3. Attempt upload of --size bytes
  4. Print one-line summary
  5. Disconnect

Usage: python ceiling_probe.py --size 7168 [--name MATRIX-R4-Runtime]
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

CMD_START, CMD_CHUNK, CMD_END, CMD_ERASE, CMD_INFO = 0x01, 0x02, 0x03, 0x06, 0x07
RSP_ACK, RSP_STATE = 0xA0, 0xA1

CHUNK_SIZE = 60


class Probe:
    def __init__(self, ble: BleakClient):
        self.ble = ble
        self._ack: Optional[asyncio.Future] = None
        self._state = None
        self._state_evt = asyncio.Event()

    def _on_notify(self, _sender, data: bytearray) -> None:
        if not data:
            return
        tag = data[0]
        if tag == RSP_ACK and len(data) >= 3 and self._ack and not self._ack.done():
            self._ack.set_result((data[1], data[2]))
        elif tag == RSP_STATE and len(data) >= 7:
            free_ram = None
            if len(data) >= 9:
                free_ram = data[7] | (data[8] << 8)
            self._state = dict(
                running=data[1],
                pc=data[2] | (data[3] << 8),
                err=data[4],
                size=data[5] | (data[6] << 8),
                free_ram=free_ram,
            )
            self._state_evt.set()

    async def start(self):
        await self.ble.start_notify(NUS_TX_UUID, self._on_notify)

    async def _send(self, cmd: int, payload: bytes = b"", timeout: float = 3.0):
        self._ack = asyncio.get_running_loop().create_future()
        t0 = time.perf_counter()
        await self.ble.write_gatt_char(NUS_RX_UUID, bytes([cmd]) + payload, response=True)
        try:
            cmd_r, status = await asyncio.wait_for(self._ack, timeout=timeout)
            return status, (time.perf_counter() - t0) * 1000, False
        except asyncio.TimeoutError:
            return 0xFF, (time.perf_counter() - t0) * 1000, True

    async def info(self):
        self._state_evt.clear()
        status, _, _ = await self._send(CMD_INFO)
        try:
            await asyncio.wait_for(self._state_evt.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            pass
        return self._state

    async def try_upload(self, size: int):
        code = bytes([0x01]) + b"\x00" * (size - 1) if size > 0 else b""
        # Wipe first so a leftover doesn't confuse the outcome.
        await self._send(CMD_ERASE)

        start_status, start_ms, start_to = await self._send(CMD_START, struct.pack("<H", size))
        if start_to or start_status != 0:
            return dict(size=size, phase="START", status=start_status, ms=start_ms,
                        chunks_ok=0, chunks_fail=0, timed_out=start_to)

        chunks_ok = 0
        chunks_fail = 0
        first_bad = None
        for i in range(0, size, CHUNK_SIZE):
            chunk = code[i:i + CHUNK_SIZE]
            s, _, to = await self._send(CMD_CHUNK, chunk)
            if to or s != 0:
                chunks_fail += 1
                if first_bad is None:
                    first_bad = s
                break
            chunks_ok += 1

        end_status, end_ms, end_to = await self._send(CMD_END)
        return dict(size=size, phase="END" if chunks_fail == 0 else "CHUNK",
                    status=end_status if chunks_fail == 0 else first_bad,
                    ms=end_ms, chunks_ok=chunks_ok, chunks_fail=chunks_fail,
                    timed_out=end_to)


async def run(name: str, size: int, scan_timeout: float) -> int:
    print(f"[probe] scan '{name}' up to {scan_timeout:.0f}s...")
    dev = await BleakScanner.find_device_by_name(name, timeout=scan_timeout)
    if dev is None:
        print(f"[probe] NOT FOUND -- BLE stack may have failed to come up")
        return 2
    print(f"[probe] found @ {dev.address}")

    async with BleakClient(dev) as ble:
        p = Probe(ble)
        await p.start()

        state = await p.info()
        if state is None:
            print(f"[probe] no RSP_STATE within 2s -- runtime unresponsive")
            return 3
        print(f"[probe] state: running={state['running']} pc={state['pc']} "
              f"err={state['err']} progSize={state['size']} freeRam={state['free_ram']}")

        r = await p.try_upload(size)
        verdict = "ACCEPTED" if (r["chunks_fail"] == 0 and r["status"] == 0 and not r["timed_out"]) else "REJECTED"
        print(f"[probe] upload size={size}: phase={r['phase']} status={r['status']} "
              f"chunks={r['chunks_ok']}/{r['chunks_ok'] + r['chunks_fail']} "
              f"timed_out={r['timed_out']}  =>  {verdict}")

        # Post-upload state check
        state2 = await p.info()
        if state2:
            print(f"[probe] post-upload state: progSize={state2['size']} freeRam={state2['free_ram']}")

    return 0 if verdict == "ACCEPTED" else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="MATRIX-R4-Runtime")
    ap.add_argument("--size", type=int, required=True)
    ap.add_argument("--scan-timeout", type=float, default=15.0)
    args = ap.parse_args()
    return asyncio.run(run(args.name, args.size, args.scan_timeout))


if __name__ == "__main__":
    sys.exit(main())
