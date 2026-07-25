# Roadmap — Features after TCP/OTA

> This roadmap lists the features planned **after** the base described in
> [MANUAL_WIFI_TCP_OTA.md](MANUAL_WIFI_TCP_OTA.md) (branch `feature/wifi-tcp-ota`)
> is complete. All of them depend on that branch's infrastructure (UDP
> discovery, the NDJSON TCP protocol, the `bin2ota` pipeline, the
> `MiniR4WiFiRuntime` wrapper) — **do not start any of them before the manual
> meets its acceptance criteria.**
>
> Like the manual, this document is self-contained enough for an AI agent
> (Claude Opus or similar) to work from without access to the conversation
> that produced it. The order below is the maintainer's priority order. Each
> feature should get its own branch off `feature/wifi-tcp-ota` (or off
> `master` once merged).

---

## R1. Multi-mission without a PC (program slots on the ESP32-S3)

**Priority: 1 (the fork's signature feature). Suggested branch: `feature/mission-slots`**

The `.ota` file is stored on the **ESP32-S3's** filesystem (8 MB) before the
RA4M1 is reflashed. So the hub can hold **several complete programs** and
switch between them with no computer:

- The app gains the concept of "slots": send a program to slot N
  (`/mission1.ota` … `/missionN.ota` on the modem's filesystem) with a
  friendly name.
- On the hub, a gesture (e.g. holding BTN_DOWN at boot) opens an **OLED menu**
  navigable with UP/DOWN listing the slots; confirming calls
  `OTAUpdate.update("/missionN.ota")` → the hub reflashes itself in ~10–20 s
  and restarts in the chosen mission.
- Slot metadata (names, sizes, dates) is kept in an index file on the modem's
  filesystem, read and written through new TCP commands (`slots_list`,
  `slot_write`, `slot_delete`).

**Target use case:** WRO — the team brings the robot to the table with every
mission already stored and switches between **full native programs** (not
bytecode) between rounds, without a laptop.

**Validate first (PoC):** does `ota.update(file_path)` accept any path on the
modem's filesystem; how many files fit; the real reflash time; behaviour with
a corrupted file (`verify()` per slot before applying).

**Acceptance:** 3 missions stored → switch between all 3 from the OLED with no
PC, 10 times in a row, without failure; a corrupted slot is detected and
refused without bricking (fallback: USB keeps working).

---

## R2. Dual send mode: "Fast (VM)" button + "Flash (OTA)" button — with live block debug

**Status: ✅ DONE** (VM over TCP on 2026-07-22, commit `4401881`; live block
debug and persistence on 2026-07-25). Hardware-validated — see the
"Session 2026-07-25" section of `docs/POC_OTA_FINDINGS.md`. Implemented on
`feature/wifi-tcp-ota` itself rather than a separate branch.

Two differences from what is described below, both driven by measured
hardware limits:

- the VM ceiling is **3584 bytes**, not 6 KB (the UNOWIFIR4 linker reserves a
  fixed heap and stack, leaving 23296 B of statics for everything);
- the PC stream runs at **10 Hz**, not 20 (every frame costs a synchronous
  ~100 ms modem write).

Beyond what is described: the VM program can be **stored in dataflash** and
run on its own at every boot with no computer — the missing piece that lets
the VM serve on the competition table too, not just during iteration.

Reuses the bytecode VM from the `feature/always-on-ble-runtime` branch,
swapping the Web Bluetooth transport (~40 B/s) for TCP (a ≤6 KB bytecode
uploads in milliseconds):

- **"Send (fast)"**: compile blocks → bytecode (existing pipeline in
  `ide_patch/blockly-core/bytecode.js` + `generator_bytecode/`) → send over
  TCP → the VM runs it. Instant iteration, no arduino-cli. Subject to the
  VM's known limits (6 KB ceiling, incomplete handlers — see
  `SESSION_2026-07-18_ALWAYS_ON_BLE.md` on the BLE branch).
- **"Flash (full)"**: the manual's OTA flow. No limits, for the competition
  program.
- Auto-suggestion: if the workspace uses blocks with no VM handler, or exceeds
  the ceiling, the app disables fast mode with a tooltip explaining why.
- The firmware has to carry the VM **and** the WiFi runtime together (measure
  flash/RAM; VM+BLE used 126,904 B and 63% RAM — without the BLE stack there
  should be room, confirm).

**Live block debug (the differentiator):** the VM knows the program counter.
Add:

- an opcode→blockId map emitted by the bytecode generator alongside the
  program;
- the VM reporting its PC over TCP (frame `{"t":"pc","addr":N}`, throttled to
  ~20 Hz);
- the IDE lighting up the running block in Blockly (Scratch-style highlight),
  with pause/step and variable inspection (`{"t":"vars"}` → dump of the VM's
  variable table).

**Acceptance:** edit a block and see the effect on the robot in under 2 s; the
live highlight follows execution; a breakpoint on a block pauses the robot;
OTA mode still works.

---

## R3. Remote console (printf without a cable)

**Status: ✅ DONE** (infrastructure on 2026-07-22, commit `806ca7a`; the
automatic redirect of the print blocks on 2026-07-25). Students do not have to
learn a new block: the wrapper rewrites `Serial.print/println` into
`WiFiRuntime.logPrint/logPrintln`, which mirror to USB **and** to the app's
console. Hardware-validated — the output read on COM10 is identical to the
remote console's.

**Priority: 3 — nearly free, do it alongside or right after the manual. Can live on `feature/wifi-tcp-ota` itself.**

- The generator redirects the `Serial.print/println` blocks to
  `WiFiRuntime.log(...)`, which mirrors to USB Serial **and** publishes the
  TCP frame `{"t":"log","s":"..."}` (ring buffer, silently dropped when
  disconnected).
- The app's existing console (which today reads USB serial) gains the TCP
  source — same panel, same text/chart UI, only the data origin changes.

**Acceptance:** a program with prints running without a cable shows its logs
in the app's console in real time; disconnecting the app neither hangs nor
slows the robot.

---

## R4. OLED mirror in the app

**Priority: 4 — cheap, high teaching value. Suggested branch: `feature/oled-mirror` (or together with R3).**

- The SSD1306 framebuffer (128×64 mono = 1 KB) lives in the RA4M1's RAM (the
  `MiniR4OLED`/Adafruit_SSD1306 class — the buffer is accessible).
- TCP command `{"t":"oled","on":true,"hz":5}` → the runtime sends the buffer
  (1 KB, optionally RLE) at ~5 Hz → the app renders it on a scaled canvas
  ("what the robot is thinking"), useful for a teacher projecting the robot's
  screen.

**Acceptance:** an animation on the physical OLED shows up in the app with
imperceptible lag (<300 ms) without degrading telemetry.

---

## R5. Live tuning (PID, thresholds, constants)

**Priority: 5. Suggested branch: `feature/live-tuning`**

- A new "adjustable parameter" block (name + initial value + min/max): the
  generator registers each parameter in a firmware table (name → pointer or
  value).
- TCP commands: `{"t":"params"}` (list) and `{"t":"set","k":"kp","v":1.8}`
  (write).
- A panel in the app with sliders generated automatically from the list;
  changes apply without reflashing. Optional persistence of the last value in
  dataflash so it survives a reboot.
- Anchor use case: tuning the DriveDC PID while watching the telemetry chart
  (setpoint × encoder) next to the sliders.

**Acceptance:** adjust Kp with the robot running and see the response in the
chart without recompiling; values persist after a reboot when the user saves.

---

## R6. Virtual remote control + teach-in

**Priority: 6. Suggested branch: `feature/remote-drive`**

- **Drive from the app:** joystick/WASD in the UI → TCP frames
  `{"t":"drive","l":N,"r":N}` (~20 Hz) → the runtime drives the motors while
  in "remote mode" (entered by command, left by a 500 ms timeout with no
  frames — a mandatory failsafe: stop the motors).
- **Teach-in:** the app records the command sequence with timestamps and turns
  it into movement blocks (`runFor`/`turn`) inserted into the workspace — you
  drove it, and it became an editable autonomous program.

**Acceptance:** drive the robot from the app with acceptable latency (<150 ms
perceived); losing the connection stops the motors within 500 ms; a 30 s
recording becomes a program that roughly reproduces the path.

---

## R7. Classroom deployment + multi-robot telemetry ("teacher mode")

**Priority: 7. Suggested branch: `feature/classroom`**

- UDP discovery already sees every robot on the network. New UI: a list of
  robots with checkboxes → **send the same program to N robots** (a queue of
  sequential OTAs with per-robot progress).
- Teacher panel: summarised telemetry for all of them (battery, state, last
  log) in a grid.
- Natural evolution (phase 2 of this feature): an MQTT broker embedded in the
  app (e.g. Aedes, pure npm) with the runtime publishing telemetry via
  PubSubClient — only migrate to MQTT if plain TCP fan-in (N sockets) shows a
  practical limit; start simple.

**Acceptance:** 5 robots receive the same program in sequence with no
intervention; the panel shows all 5 live; a failure on one robot does not
interrupt the queue.

---

## R8. Phone dashboard (web page served by the app)

**Priority: 8. Suggested branch: `feature/phone-dashboard`**

- The app already runs an HTTP server for OTA; expand it (separate port, e.g.
  47803) to serve a minimal SPA (a single HTML file, no build) with: live
  telemetry (WebSocket → bridge to the robot's TCP), a START/STOP button, and
  a round timer.
- The student opens `http://<laptop-ip>:47803` on their phone — nothing to
  install.
- Note: the page is read-only plus start/stop; no destructive commands and no
  uploads through it.

**Acceptance:** a phone on the same network sees live telemetry and can
trigger START; two phones work simultaneously.

---

## R9. Integrated OpenMV viewer

**Priority: 9 — an independent module, can run in parallel with any other. Suggested branch: `feature/openmv-viewer`**

Do not embed the OpenMV IDE (Qt, GPL, heavy maintenance). Instead, speak
OpenMV's **open USB debug protocol**, whose reference implementation is
`pyopenmv.py` (repo `openmv/openmv`, folder `tools/`): serial connection,
sending a MicroPython script, and framebuffer streaming.

- Port the essentials of `pyopenmv.py` to JS on top of the `@serialport`
  **already bundled** in the app.
- A new "Camera" tab: live framebuffer stream (canvas) + a MicroPython script
  editor using the **already integrated Monaco** (the fork's C++ mode) +
  run/stop/save-to-camera buttons.
- Deliberately minimal scope: see the image, edit and run a script. No
  MicroPython debugger, no package manager — the official OpenMV IDE exists
  for that.
- Video **through the hub** is out of scope (the hub's UART limits it to a
  useless ~1 fps); the camera connects straight to the PC's USB. On the robot,
  the OpenMV talks to the hub over UART with detection messages only (via
  `SmartCamReader`/its own protocol), as it does today.

**Acceptance:** plug an OpenMV into USB → the Camera tab shows live video;
edit and run a script without opening the OpenMV IDE; unplugging the camera
does not affect the rest of the app.

---

## R10. Hub firmware manager

**Priority: 10 (quality of life). Suggested branch: `feature/firmware-manager`**

A "Hub Firmware" panel with each layer's version and an update button:

| Layer | Version via | Update |
|---|---|---|
| User sketch/runtime | TCP command `info` (field `fw`) | OTA (already exists) |
| Bundled MatrixMiniR4 library | local `library.properties` | ships with the app |
| ESP32-S3 usb-bridge | `WiFi.firmwareVersion()` reported in `info` | USB, orchestrating `arduino-fwuploader` (bundle it in the app, like arduino-cli) |
| STM32F103 (MMLower) | internal MMLower protocol (investigate in `Modules/MMLower.cpp`) | USB/DFU — wrap the existing `dfu/` folder flow (STM32_Programmer_CLI) in a UI with a changelog |

- Investigation recorded separately: *wireless* STM32 updates via the RA4M1
  (the F103's UART bootloader) — **not promised**; document feasibility in
  `docs/STM32_OTA_FINDINGS.md` before implementing anything.

**Acceptance:** the panel shows the 4 correct versions; update the usb-bridge
and the MMLower from the app without external tools; any failure leaves
recovery instructions on screen.

---

## Out of scope (recorded decisions)

- **HuskyLens detection overlay on telemetry** — considered and dropped for
  now: the maintainer does not have the camera to test with. Reconsider if the
  hardware becomes available; the design is described in the originating
  conversation (rectangles/IDs over TCP telemetry, no video).
- **Porting the VM into the base TCP/OTA branch** — no; the VM only arrives
  via R2. *(R2 is now done, so it did.)*
- **MQTT as the primary transport** — no; at most it arrives as an internal
  evolution of R7.
