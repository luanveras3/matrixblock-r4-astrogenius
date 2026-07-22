"""
Phase 2 driver: bump MAX_PROGRAM in the runtime .cpp, reflash, probe.
Repeats for each size in the sweep list.

Usage: python ceiling_sweep.py [--port COM10]
"""
import argparse
import re
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
RUNTIME_CPP = REPO / "arduino" / "libraries" / "MatrixMiniR4" / "src" / "Modules" / "MiniR4BLERuntime.cpp"
FLASH_PS1   = REPO / "arduino" / "libraries" / "MatrixMiniR4" / "examples" / "6-VM Runtime" / "flash.ps1"
PROBE_PY    = Path(__file__).with_name("ceiling_probe.py")

CPP_RE = re.compile(r"^(constexpr uint16_t MAX_PROGRAM\s*=\s*)(\d+)(;.*)$", re.MULTILINE)


def set_max_program(new_val: int) -> int:
    src = RUNTIME_CPP.read_text(encoding="utf-8")
    m = CPP_RE.search(src)
    if not m:
        raise SystemExit(f"could not locate MAX_PROGRAM in {RUNTIME_CPP}")
    old_val = int(m.group(2))
    src2 = CPP_RE.sub(lambda mm: mm.group(1) + str(new_val) + mm.group(3), src, count=1)
    RUNTIME_CPP.write_text(src2, encoding="utf-8")
    return old_val


def flash(port: str) -> tuple[int, str]:
    r = subprocess.run(
        ["powershell.exe", "-NoProfile", "-File", str(FLASH_PS1), "-Sync", "-Port", port],
        capture_output=True, text=True, timeout=300)
    return r.returncode, (r.stdout + r.stderr)


def probe(size: int) -> tuple[int, str]:
    r = subprocess.run(
        [sys.executable, str(PROBE_PY), "--size", str(size)],
        capture_output=True, text=True, timeout=180)
    return r.returncode, (r.stdout + r.stderr)


def parse_compile_stats(flash_output: str) -> dict:
    stats = {}
    for line in flash_output.splitlines():
        m = re.search(r"Global variables use (\d+) bytes.*leaving (\d+) bytes", line)
        if m:
            stats["static"] = int(m.group(1))
            stats["linker_free"] = int(m.group(2))
        m = re.search(r"Sketch uses (\d+) bytes", line)
        if m:
            stats["flash"] = int(m.group(1))
    return stats


def parse_probe(probe_output: str) -> dict:
    d = {}
    for line in probe_output.splitlines():
        m = re.search(r"freeRam=(\d+)", line)
        if m and "post-upload" not in line:
            d["free_ram_pre"] = int(m.group(1))
        m = re.search(r"post-upload state:.*freeRam=(\d+)", line)
        if m:
            d["free_ram_post"] = int(m.group(1))
        if "upload size=" in line:
            m = re.search(r"=>\s+(\w+)", line)
            if m:
                d["verdict"] = m.group(1)
    d["not_found"]  = "NOT FOUND" in probe_output
    d["unresponsive"] = "unresponsive" in probe_output
    return d


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default="COM10")
    ap.add_argument("--sizes", default="7168,8192,9216,10240,12288",
                    help="comma-separated MAX_PROGRAM values to try (upload size = same)")
    args = ap.parse_args()

    sizes = [int(x) for x in args.sizes.split(",")]

    print(f"Sweep sizes: {sizes}")
    print(f"Runtime file: {RUNTIME_CPP}")
    print()

    results = []
    original = None
    try:
        for size in sizes:
            print(f"===== MAX_PROGRAM = {size} =====")
            old = set_max_program(size)
            if original is None:
                original = old
                print(f"  (baseline before sweep was {original})")

            print(f"  [flash] compiling + uploading...")
            rc, out = flash(args.port)
            stats = parse_compile_stats(out)
            print(f"  [flash] rc={rc}  static={stats.get('static')}  linker_free={stats.get('linker_free')}  flash={stats.get('flash')}")
            if rc != 0:
                print(f"  [flash] FAILED, aborting this size")
                results.append(dict(size=size, flash_rc=rc, **stats,
                                    probe="skipped-flash-failed"))
                continue

            # Give the R4 time to boot + BLE stack to come up.
            print(f"  [wait] 6s for boot + BLE advertise...")
            time.sleep(6.0)

            print(f"  [probe] connecting + uploading {size}B...")
            prc, pout = probe(size)
            pdata = parse_probe(pout)
            print(f"  [probe] rc={prc}  verdict={pdata.get('verdict','?')}  "
                  f"freeRam pre={pdata.get('free_ram_pre','?')} post={pdata.get('free_ram_post','?')}  "
                  f"not_found={pdata['not_found']}  unresponsive={pdata['unresponsive']}")

            results.append(dict(size=size, flash_rc=rc, **stats,
                                probe_rc=prc, **pdata))
            print()

    finally:
        if original is not None:
            print(f"===== Restoring MAX_PROGRAM = {original} =====")
            set_max_program(original)
            print(f"  [flash] final restore...")
            rc, out = flash(args.port)
            stats = parse_compile_stats(out)
            print(f"  [flash] rc={rc}  static={stats.get('static')}  linker_free={stats.get('linker_free')}")
            time.sleep(4.0)

    print()
    print("===== SWEEP SUMMARY =====")
    print(f"{'size':>6} {'static':>8} {'linker':>8} {'freeRam':>9} {'verdict':>12}")
    for r in results:
        print(f"{r.get('size','?'):>6} {r.get('static','?'):>8} "
              f"{r.get('linker_free','?'):>8} {r.get('free_ram_pre','?'):>9} "
              f"{r.get('verdict','?'):>12}"
              + (f"  (not_found)" if r.get('not_found') else "")
              + (f"  (unresponsive)" if r.get('unresponsive') else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
