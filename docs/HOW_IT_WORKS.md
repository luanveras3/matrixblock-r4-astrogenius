# How it works — and how we got here

This explains the two ways a program reaches the robot in this fork, why there
are two, and what each one costs. It is written for someone who has never seen
the code: a teacher deciding whether to trust it, a developer picking the work
up, or someone at MATRIX Robotics deciding whether any of it is worth adopting.

Every number here was measured on real hardware. Where something is a design
guess rather than a measurement, it says so.

---

## 1. The problem

A classroom has one hub per team and one laptop with the cable. Every change —
one wrong number, one block in the wrong place — means walking the robot back
to the laptop, plugging in, waiting for a compile, unplugging, walking back.
The robot is on the floor mid-run; the cable is across the room.

So: **send the program without the cable.** That is the whole objective. Every
decision below follows from it.

---

## 2. The hardware, and why one fact dominates

The MATRIX Mini R4 hub is an **Arduino UNO R4 WiFi** plus a motor coprocessor.
Three programmable chips:

| Chip | What it runs | How it is programmed | DFU? |
|---|---|---|---|
| **RA4M1** (Renesas, 256 KB flash, 32 KB RAM) | the student's sketch, and everything this fork adds | `arduino-cli` over USB, **or OTA over WiFi** | no |
| **ESP32-S3** | the WiFi/BLE modem ("usb-bridge" firmware) | `arduino-fwuploader` over USB | no |
| **STM32F103** | motors and encoders (MMLower) | `STM32_Programmer_CLI` in DFU mode | yes |

**Everything this fork ships lives in the RA4M1 layer.** That is why no part of
this project has ever needed DFU, and why wireless upload is possible at all —
it reprograms exactly that layer.

The dominating fact: **WiFi and BLE share the ESP32-S3 modem and do not work
well at the same time.** A sketch gets one or the other. That single constraint
is what forced the choice described next.

---

## 3. How we got to WiFi — the honest version

### It started as BLE, with a virtual machine

The first attempt used Bluetooth Low Energy and a **bytecode VM**: instead of
compiling and flashing, the IDE turned the blocks into a compact instruction
stream and sent *that*. The robot ran an interpreter, so a program arrived in
under a second.

It worked. Then it hit three walls, all of which are properties of BLE rather
than bugs:

- **Throughput ~40 B/s.** A 4 KB program took around 100 seconds.
- **A 6 KB ceiling** on program size — roughly 1000–1200 real blocks — and the
  limit was linker-hard, not tunable.
- **Partial block coverage.** Every block needs a hand-written opcode handler.
  Strings, some sensors, and several movement blocks simply had none, and the
  student had no way to know until the upload failed.

The last one is the one that mattered in a classroom. "This block doesn't work
wirelessly" is not an explanation a twelve-year-old should have to absorb.

### So the transport changed, and the strategy with it

WiFi TCP replaced BLE, and a **real firmware upload (OTA)** replaced the VM:

| | VM over BLE | OTA over WiFi |
|---|---|---|
| Upload speed | ~40 B/s | tens–hundreds of KB/s |
| Program limit | 6 KB of bytecode | the RA4M1's 256 KB of flash |
| Block coverage | partial, hand-written per block | **100% — it runs the real generated C++** |
| Robustness | starvation dropped the connection | TCP buffers through a blocked loop |
| App side | Web Bluetooth, flaky under Electron | native Node sockets |
| Multiple robots | duplicate names, no picker | unique IP, UDP discovery, a picker |
| Cost | instant iteration | a real compile, ~30 s per upload |

100% block coverage is the decisive row. It is not a feature you can approximate
— either every block a student can drag works, or the tool is a lie.

### And then the VM came back anyway

The original decision document says, in bold: *do not port the VM here.*

That was reversed, and the reversal is the interesting part. The one column
where the VM won — **instant iteration** — turned out to matter more than it
looked on paper. Thirty seconds is nothing when you upload twice. It is
everything when you are hunting a wrong threshold and upload forty times.

So the VM was ported over TCP and now lives **alongside** OTA rather than
instead of it. Both paths are wireless; the student picks the trade.

The lesson worth keeping: the comparison table was right about every fact and
wrong about the conclusion, because it compared the two paths as replacements
when they are complements.

---

## 4. Path A — OTA, the real firmware upload

Use it when the program is finished, or when it uses a block the VM does not
implement. It produces exactly what a cable upload produces, because it *is*
the same binary.

### The chain

```
blocks
  → generated C++ (the stock MATRIXblock generator)
    → arduino_wifi_wrapper.js rewrites three things (see §6)
      → arduino-cli compiles                            ~15–30 s
        → sketch.bin
          → bin2ota.js  →  sketch.ota                   LZSS + header
            → the IDE serves it over HTTP on the LAN    port 47800
              → {"t":"ota","url":...} over TCP          port 47802
                → the MODEM downloads it over HTTP
                  → verify (CRC32)
                    → the modem reflashes the RA4M1
                      → reboot
```

### The `.ota` format

A faithful port of Arduino's own tools (`lzss.c`, `bin2ota.py`), in
[`tools/bin2ota.js`](../tools/bin2ota.js), zero dependencies:

```
[0..3]   payload length
[4..7]   CRC32 over magic + version + payload
[8..11]  magic 0x23411002      (UNO R4 WiFi's VID/PID)
[12..19] version, byte 7 = 0x40 (payload is LZSS)
[20..]   LZSS-compressed sketch binary
```

### Why the modem does the downloading

`OTAUpdate` has the **ESP32-S3** fetch the file into its own flash, not the
RA4M1's. This matters: the alternative approach (ArduinoOTA-style) stages the
image in the main chip's flash, which halves the space available to the
student's program. Here the image never touches RA4M1 flash until it is being
applied.

The IDE therefore has to be an HTTP server for a few seconds. It binds 47800,
falling back to an ephemeral port if that is taken.

### Discovery

The robot listens for a UDP broadcast on **47801** and answers with its name,
IP, firmware version and battery. Commands and telemetry then flow as **NDJSON
over TCP 47802** — one JSON object per line, in both directions.

### What it costs, measured

A 20-round stress test (`tools/stress_upload_wifi.js`), 140 KB sketch / 112 KB
`.ota`, hub in AP mode:

```
18/20 succeeded · average 37.3 s · best ~32 s · worst 70.6 s
```

Both failures were **on the PC side, not the robot's**: the robot came back
healthy on the next round every time, meaning the OTA completed and the modem
finished flashing. What timed out was the laptop re-associating with the hub's
access point after the reboot.

### Limits you should know about

- **The modem firmware must be ≥ 0.5.0.** `startDownload` does not exist below
  that, and the failure used to surface as a bare error code after a full
  compile. The IDE now checks the version first and refuses in about a second,
  naming what it found and what it needs.
- **OTA needs a network by definition** — the modem fetches over HTTP. Over the
  USB cable the request is refused with a clear message, because USB users have
  `arduino-cli`, which is the better tool there anyway.
- **One TCP client at a time.** A dead client used to lock everyone else out;
  the runtime now preempts a connection that has been idle for 15 s when
  someone else knocks.

---

## 5. Path B — the bytecode VM, for the fast loop

Use it while you are still figuring the program out.

### How it works

The IDE compiles blocks to a compact instruction stream and sends it over the
same TCP connection. The robot loads it into a buffer and interprets it — no
compile, no reflash, no reboot. Arrival is effectively instant.

The machine is deliberately small:

| | |
|---|---|
| Value type | a single `int32_t` (booleans are 0/1) |
| Operand stack | 32 entries |
| Variables | 16 slots |
| Call stack | 8 frames |
| Program buffer | **3584 bytes** |
| Opcodes | ~94 |

### It survives a power cycle

A program can be kept on the robot: it is written to dataflash (blocks 1–4,
magic `MBVM`) and reloaded at boot. The config lives separately in block 6
(`MBRW`).

Saved programs are tied to a **sketch id**. An earlier version treated id 0 as
"any sketch", which let a saved VM program be adopted by a completely unrelated
sketch — the match is now exact.

### Limits, and where they come from

- **3584 bytes of program.** That number is not arbitrary and not tunable by
  preference — see §7. It buys roughly 600–700 real blocks.
- **Partial block coverage.** Every block needs a hand-written opcode handler.
  The last figure recorded in `docs/NEXT_SESSION.md` is 116 of the 193 blocks
  the Arduino generator supports; later rounds added more without a fresh
  count. Anything not covered still works — over OTA.
- **`int32_t` only.** No floats yet. Division truncates.

### Live block debug — shipped, then withdrawn

The VM streams its program counter, and the compiler emits a map from program
counter back to block id, so the block currently executing can be highlighted
while the robot runs, with breakpoints and variable inspection.

It works at the protocol level and it is in the build. **The UI is not in the
menus**, because the experience was not dependable enough to put in front of a
classroom. The machinery is reachable from the console
(`window.MBR4VMDebug._install()`) and is documented rather than deleted, so
returning to it does not mean starting over.

---

## 6. The rewrite that makes any of this work

The single hardest bug in this project had nothing to do with radios.

The runtime is **cooperative**: it only gets to service the network when the
sketch's `loop()` comes back around. The stock generator compiles the
`wait until` block to a bare busy-wait:

```cpp
while (!MiniR4.BTN_UP.getState());   // nothing else runs. ever.
```

Almost every student program starts with exactly that — "wait for the button so
the run starts when I say so". The Arduino begins running the instant it
resets, so a start gate is not an advanced technique, it is the first thing
anyone needs.

The result: the robot vanished from the network the moment it was unplugged,
and looked broken.

`arduino_wifi_wrapper.js` rewrites the generated sketch before compiling:

- `delay(n)` → `safeDelay(n)`, which services the runtime while it waits;
- `Serial.print(...)` → `WiFiRuntime.logPrint(...)`, so print output reaches
  the remote console;
- a blocking start gate → `WiFiRuntime.waitForStart()`, which yields properly
  and can also be released remotely from the app's Start button.

Full write-up, including the false starts: [BUG_BLOCKING_USERLOOP.md](BUG_BLOCKING_USERLOOP.md).

**This one is worth reading even if you never use this fork.** Any cooperative
runtime on this platform — including anything MATRIX might build — is starved
from the first statement of the typical student program. It is a property of
the generator output, not of our code.

---

## 7. The constraint that shapes everything: static RAM

UNOWIFIR4's linker script reserves a **fixed 8 KB heap** and a **fixed 1 KB
main stack** out of 32 KB, minus a 256-byte vector table. Everything static
must therefore fit in **23296 bytes**, and overflowing it is a **link error**,
not a warning:

```
ld.exe: section .stack_dummy VMA [20007b00,20007eff]
        overlaps section .heap VMA [20005b38,20007b37]
```

At one point the build was at 23190 bytes — **106 bytes of slack**. Adding the
print-mirror line buffer and the debug state pushed it over, and the VM program
buffer was cut from 4096 to **3584 bytes** to pay for it. That is where the
number in §5 comes from: it is what was left after everything else.

A useful discovery that made the rest affordable: the I2C sensor drivers are
already members of `MiniR4.I2C1..I2C4`, so adding sensor opcodes costs **flash,
not static RAM**. Flash had ~100 KB free; static RAM had ~228 bytes.

One correction worth recording: an earlier note claimed "9.6 KB of stack
headroom". That was a misreading of `arduino-cli`'s *free RAM* figure, which is
heap and stack combined. The actual stack is 1 KB and never changes.

---

## 8. Other measured limits

- **~100 ms per outgoing frame.** Every WiFi write to the modem is synchronous
  and blocks. That is what caps telemetry at about **9.4 Hz** rather than the
  10 it asks for, and why telemetry is only requested while the HUD tab is
  actually visible.
- **The radio outlives the firmware.** After going back to the official app and
  uploading, the ESP32-S3 keeps the access point up across a reflash of the
  RA4M1: the robot still appears in the WiFi list, still answers a ping, and
  port 47802 still accepts a TCP connection — with nothing behind any of it,
  and the radio still drawing current. Only a full power cycle brings it down.
  Verified by association attempt, because the OS's network *list* keeps
  showing an access point for minutes after it stops transmitting.
- **A `.bak` filename proves nothing about an archive's contents.** On the
  bench machine, four of six `app.asar*` files were old fork builds. Anything
  that decides "is this the official build?" has to read the archive.

---

## 9. Where to read next

| Question | File |
|---|---|
| What changed in each release | [../CHANGELOG.md](../CHANGELOG.md) |
| Which upstream files we touch, and why | [UPSTREAM_CHANGES.md](UPSTREAM_CHANGES.md) |
| The raw hardware measurements | [POC_OTA_FINDINGS.md](POC_OTA_FINDINGS.md) |
| The cooperative-runtime bug, in full | [BUG_BLOCKING_USERLOOP.md](BUG_BLOCKING_USERLOOP.md) |
| The original architecture spec | [../MANUAL_WIFI_TCP_OTA.md](../MANUAL_WIFI_TCP_OTA.md) |
| What to do next | [NEXT_SESSION.md](NEXT_SESSION.md) |

The commit messages carry the *why* for individual decisions, including the
ones that were wrong and were withdrawn. Several record measurements taken on
real hardware, and at least four record a conclusion that had to be retracted
after a better measurement — those are usually the useful ones.
