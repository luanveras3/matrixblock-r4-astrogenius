# Implementation Manual — WiFi Upload (TCP + real OTA) and Telemetry

> **Who this is for:** an AI agent (Claude Opus or similar) or a human
> developer implementing this feature **without access to the conversation
> that produced it**. It is self-contained: project context, architecture
> decision, protocol specification, implementation phases, known risks and
> acceptance criteria.
>
> **Working branch:** `feature/wifi-tcp-ota` (this branch). Do **not** modify
> `feature/always-on-ble-runtime` — it stays as the fallback.
>
> **Status note (2026-07-25):** this is the original specification. It has
> been implemented and hardware-validated, and reality diverged from it in a
> few places — most notably the dataflash map in §1.1 (block 6 holds the
> `MBRW` config, blocks 1–4 hold saved VM bytecode; the authoritative map is
> the header comment in `MiniR4WiFiRuntime.h`) and §1.3's "do not port the VM
> here", which roadmap item R2 deliberately reversed. For what is actually
> built, read `docs/HANDOFF_NEXT_PHASES.md` and `CHANGELOG.md`; for what to
> do next, `docs/NEXT_SESSION.md`.

---

## 1. Project context

This repository is a community fork (AstroGenius Team, Brazil) of
**MATRIXblock Mini R4 v1.0.8**, MATRIX Robotics' official software for the
**MATRIX Mini R4** hub. Target audience: competitive educational robotics
(WRO and similar).

### 1.1 Hub hardware (relevant facts)

- Core: **Arduino UNO R4 WiFi** — main MCU Renesas **RA4M1** (256 KB flash,
  32 KB RAM) plus an **ESP32-S3** as the WiFi/BLE modem, connected to the
  RA4M1 over SPI ("usb-bridge firmware").
- **STM32F103** coprocessor for motors/encoders (internal communication,
  irrelevant here).
- The `arduino/libraries/MatrixMiniR4/` library exposes everything: motors
  M1–M4 with encoders and PID, servos RC1–RC4, IMU, OLED (SSD1306 @0x3D),
  buzzer, RGB, two buttons, four I2C ports, MATRIX sensors.
- **WiFi through `WiFiS3.h`** (already included by `MatrixMiniR4.h`).
  Supports station mode, **AP mode** (`WiFi.beginAP`) and **UDP
  multicast/broadcast** (`WiFiUDP`).
- **Important constraint:** WiFi (WiFiS3) and BLE (ArduinoBLE) share the
  ESP32-S3 modem and **do not work well simultaneously**. This feature uses
  WiFi only; the BLE runtime must not be active in the same sketch.
- **8 KB of dataflash** (on the RA4M1), with a layout already defined by the
  BLE branch:
  - Block 0: IMU calibration (reserved)
  - Blocks 1–4: VM bytecode (used only by the BLE branch)
  - Block 5: BLE-enable flag (used only by the BLE branch)
  - **Blocks 6–7: free — use for WiFi credentials and this feature's flags.**

### 1.2 Software (app architecture)

- **Electron** app (fork of the official one). The patched source lives in
  `resources/app_src/` (`app.compressed.js`, ~100 KB, is the bundled
  main+renderer; `blockly-core/` holds blocks and generators; `views/main.html`
  is the UI).
- The build injects the files from `app_src/` into `resources/app.asar` via
  **`node patch_asar.js`** (a surgical patching approach — this is not a
  "normal" Electron app with its own package.json; respect that flow).
- Smoke test: **`node test_app.js`** (Playwright).
- Programming pipeline: Blockly → C++ generator (`blockly-core/generator/`) →
  `.ino` sketch → **`arduino/arduino-cli.exe`** (bundled, with the
  `arduino:renesas_uno` core) compiles → USB serial upload.
- The `feature/always-on-ble-runtime` branch added a **bytecode VM** (77
  opcodes, `MiniR4VM.cpp`, `MiniR4BLERuntime.cpp`, generator in
  `ide_patch/blockly-core/bytecode.js` and `generator_bytecode/`) with
  uploads over Web Bluetooth at ~40 B/s. Limitations are documented in
  `arduino/libraries/MatrixMiniR4/examples/6-VM Runtime/SESSION_2026-07-18_ALWAYS_ON_BLE.md`:
  an empirical ceiling of **6 KB of bytecode** (~600–1000 blocks), incomplete
  handlers (strings, ultrasonic, DriveDC), BLE stack starvation when user code
  blocks, no device picker, and very low throughput.

### 1.3 Architecture decision (already made — do not reopen)

**Replace the BLE transport with WiFi TCP, and replace the VM with a real
firmware upload (OTA).**

| Criterion | VM + BLE (current) | OTA + WiFi TCP (this feature) |
|---|---|---|
| Upload speed | ~40 B/s (100 s for 4 KB) | tens–hundreds of KB/s |
| Program limit | 6 KB of bytecode (~600–1000 blocks) | the RA4M1's 256 KB of flash (thousands of blocks; effectively unlimited) |
| Block coverage | ~36 handlers, missing strings/US/DriveDC | **100%** — it runs the real generated C++ |
| Connection robustness | starvation → dropped connection | TCP tolerates blocking (buffering) |
| App side | Web Bluetooth (flaky under Electron) | native Node sockets (`net`, `dgram`, `http`) |
| Multi-robot | duplicate names, no picker | unique IP + UDP discovery + picker |
| Cost | instant iteration (14 B/block) | arduino-cli recompile (~15–30 s per upload) |

The one place where the VM wins — instant iteration — does not outweigh its
limitations. The VM stays available on its own branch as a possible future
alternative mode; **do not port the VM here.**
*(Reversed later: roadmap R2 ported the VM over TCP precisely to get that
instant iteration back, alongside OTA rather than instead of it.)*

**Chosen OTA mechanism:** the official **`OTAUpdate`** library from the
`arduino:renesas_uno` core (ArduinoCore-renesas, `libraries/OTAUpdate`). API:

```cpp
#include <OTAUpdate.h>
OTAUpdate ota;
ota.begin("/update.bin");              // path on the ESP32-S3 filesystem
ota.download(url, "/update.bin");      // the MODEM (ESP32-S3) downloads over HTTP(S)
ota.verify();                          // validates the .ota header + CRC
ota.update("/update.bin");             // reflashes the RA4M1 and reboots
```

Key points: the `.ota` file lives in the **ESP32-S3's** flash (it does not
consume RA4M1 flash — so there is no "half the flash" limit like the
JAndrassy/ArduinoOTA alternative); the `.ota` format is Arduino Cloud's
(header + **LZSS** payload); the Electron app serves the file over **HTTP on
the LAN**.

---

## 2. Target architecture

```
┌────────────────────── Electron app ──────────────────────┐
│ Blockly → C++ (existing generator, NO bytecode)          │
│ arduino-cli compile → sketch.bin                         │
│ bin2ota (new, Node) → sketch.ota                         │
│ ephemeral HTTP server (port 47800) serving sketch.ota    │
│ UDP discovery client (broadcast, port 47801)             │
│ TCP command client (robot's port 47802)                  │
│ UI: "Send via WiFi" button, robot picker, progress       │
└──────────────────────────────────────────────────────────┘
                    │ WiFi (robot's AP OR the local network)
┌────────────────────── Firmware (wrapper) ────────────────┐
│ MiniR4WiFiRuntime (new module in the MatrixMiniR4 lib):  │
│  - joins WiFi (credentials in dataflash) or opens an AP  │
│  - answers UDP discovery (name, IP, version, battery)    │
│  - TCP server on 47802: NDJSON commands                  │
│  - telemetry: NDJSON push on the same socket             │
│  - OTA command → OTAUpdate.download/verify/update        │
│  - non-blocking poll called from loop() (wrapper)        │
└──────────────────────────────────────────────────────────┘
```

### 2.1 Discovery protocol (UDP, port 47801)

- The app broadcasts (`255.255.255.255:47801`, and `192.168.4.255` in AP
  mode): `{"t":"MBR4_DISCOVER","v":1}`
- Each robot answers unicast to the sender:
  `{"t":"MBR4_HERE","v":1,"name":"<name>","mac":"<suffix4>","ip":"x.x.x.x","fw":"<wrapper version>","batt":<volts>,"mode":"ap"|"sta"}`
- Default `name`: `MBR4-<last 4 hex digits of the MAC>` — this fixes the
  duplicate-name problem documented on the BLE branch. A custom name is
  persisted in dataflash.

### 2.2 Command protocol (TCP, port 47802, NDJSON — one JSON object per line)

App → robot requests:

| Command | Payload | Response |
|---|---|---|
| `{"t":"ping"}` | — | `{"t":"pong","fw":"...","uptime":ms}` |
| `{"t":"info"}` | — | name, versions, battery, detected I2C ports |
| `{"t":"telemetry","on":true,"hz":10}` | starts/stops the stream | continuous `{"t":"tm",...}` frames |
| `{"t":"ota","url":"http://<app-ip>:47800/sketch.ota","size":N,"crc":"..."}` | starts an OTA | `{"t":"ota_status","phase":"download"|"verify"|"apply","pct":N}`, then a reboot |
| `{"t":"setname","name":"..."}` | writes to dataflash | ack |
| `{"t":"setwifi","ssid":"...","pass":"..."}` | writes credentials (dataflash blocks 6–7) | ack |

Telemetry frames (robot → app, same socket): reuse **exactly the format and
fields the fork's BLE telemetry already sends** (see the implementation in
`arduino/libraries/MatrixMiniR4/src/Modules/MiniR4BLERuntime.cpp` and the
consumer in `app_src/app.compressed.js`), so the existing dashboard works
unchanged with only the source swapped.

### 2.3 Full upload flow

1. The user clicks **"Send via WiFi"**.
2. The app compiles with arduino-cli (reuse the existing USB upload flow; the
   `--export-binaries` flag already produces a `.bin`).
3. The app converts `.bin` → `.ota` (the `bin2ota.js` module, see Phase 1).
4. The app starts an ephemeral HTTP server on port 47800 serving the `.ota`.
5. The app sends `{"t":"ota","url":...}` over TCP to the selected robot.
6. The robot reports progress; the modem downloads the file; `verify()`;
   `update()` → reboot.
7. The new sketch (which embeds the wrapper again) starts announcing itself
   over UDP; the app reconnects and confirms the new version (`fw` changes) →
   success in the UI.
8. The app shuts the HTTP server down.

### 2.4 Sketch wrapper (generator)

Same in spirit as the BLE branch's `arduino_ble_wrapper.js` (the reference for
how to wrap `userSetup`/`userLoop`), but **without a VM**: user code runs
natively.

```cpp
#include <MatrixMiniR4.h>
#include "MiniR4WiFiRuntime.h"

void userSetup() { /* setup() generated from the blocks */ }
void userLoop()  { /* loop() generated from the blocks */ }

void setup() {
    MiniR4.begin();
    WiFiRuntime.begin();   // WiFi + discovery + TCP server; does not block if it cannot connect
    userSetup();
}
void loop() {
    WiFiRuntime.poll();    // non-blocking
    userLoop();
}
```

Mitigations for the starvation problem (documented on the BLE branch — it
applies to any transport):

- The generator replaces the blocks' `delay(x)` with
  `WiFiRuntime.safeDelay(x)` (which slices the wait into ~20 ms steps and
  calls `poll()` between them). The existing C++ generator centralises where
  `delay` is emitted — change it there.
  *(Known gap, 2026-07-25: this covers waits but not loops. See
  `docs/BUG_BLOCKING_USERLOOP.md`.)*
- **Recovery mode (mandatory):** holding **BTN_UP at boot** makes `begin()`
  enter a network-only loop (it never calls `userLoop`), with "OTA MODE" and
  the IP on the OLED. This guarantees a stuck user sketch can never take the
  robot off the air — the worst case becomes "reboot holding the button".
- The final fallback remains the normal USB upload (unchanged).

---

## 3. Implementation phases

Implement **in this order**; every phase has a testable deliverable. Commits
in English, in the repo's style (`feat(...)`, `fix(...)`, `docs(...)` — see
`git log`). After changing `app_src`, run `node patch_asar.js` and
`node test_app.js`.

### Phase 0 — Manual proof of concept (without touching the app) ⚠️ DO THIS FIRST

Validates this feature's three unknowns before any product code is written:

1. Update the hub's usb-bridge (ESP32-S3) firmware to the latest version
   (Arduino IDE → Firmware Updater, or `arduino-fwuploader`). OTA depends on
   a recent modem firmware.
2. A test sketch based on the official example
   `ArduinoCore-renesas/libraries/OTAUpdate/examples/OTA/OTA.ino`, adapted to
   download from a **local HTTP server** (e.g. `python -m http.server`
   serving a `.ota`).
3. Generate the `.ota` for a blink sketch with Arduino's reference tooling
   (`bin2ota.py` + `lzss.py` in the `arduino/ArduinoIoTCloud` repo, folder
   `extras/tools/`, or `arduino-cloud-cli ota encode`). Record the bytes of
   the generated header (it becomes the fixture for Phase 1).
4. **Answer and record in `docs/POC_OTA_FINDINGS.md`:**
   - Does `ota.download()` accept plain `http://` (no TLS)? (If **not**:
     plan B is serving over HTTPS with a fixed certificate embedded in the
     app via `setCACert`, generated once and committed; the robot trusts only
     that one.)
   - The minimum sketch size for `MatrixMiniR4 + WiFiS3 + OTAUpdate` (it must
     fit comfortably in 256 KB; the BLE branch measured 126,904 B with the VM
     — without the VM it should drop).
   - Total download+verify+update time for a ~150 KB sketch.
   - Does OTA work in **AP mode**? (the download is done by the modem; test
     with the app on the robot's AP network serving the file). If it does not
     work in AP, document it and require station mode (a phone hotspot or the
     classroom router) for OTA, keeping AP for telemetry.

### Phase 1 — `bin2ota` in Node

- New file `tools/bin2ota.js` (CommonJS, no external dependencies): a faithful
  port of Arduino's `bin2ota.py` + `lzss.py` (format: a header with
  length/CRC32/board magic number — for the UNO R4 WiFi the magic derives from
  VID/PID `0x2341`/`0x1002` — followed by the **LZSS**-compressed binary;
  confirm the exact fields by reading the reference scripts in Phase 0).
- Test: `tools/bin2ota.test.js` compares the output byte for byte against the
  `.ota` fixture produced by the official tool in Phase 0. **Do not proceed
  without binary equality.**

### Phase 2 — Firmware: `MiniR4WiFiRuntime`

- New files:
  `arduino/libraries/MatrixMiniR4/src/Modules/MiniR4WiFiRuntime.{h,cpp}`.
- Implements: credentials/name in dataflash (blocks 6–7), STA with AP
  fallback (`MBR4-<mac4>` / a documented default password), UDP discovery
  (§2.1), NDJSON TCP server (§2.2), `safeDelay()`, BTN_UP recovery mode, and
  the OTA handler calling `OTAUpdate`.
- JSON parser: minimal/hand-written (messages are small and flat — do not add
  ArduinoJson, to save flash/RAM; RAM was already at 63% on the BLE branch).
- Compilable example: `examples/7-WiFi Runtime/MiniR4_WiFi_Runtime.ino`.
- Telemetry: extract the frame serialisation from `MiniR4BLERuntime.cpp` into
  a shared helper (or duplicate it with a comment, if extracting would mean
  touching the BLE branch — prefer duplicating here over touching BLE code).

### Phase 3 — Electron app: transport + UI

- New `resources/app_src/blockly-core/wifi_upload.js` (mirroring the BLE
  branch's `ble_upload.js`, which serves only as an integration reference):
  UDP discovery (`dgram`), TCP client (`net`), ephemeral HTTP server (`http` —
  serve the `.ota` from a random path, accept only the target robot's IP,
  shut down at the end), and the §2.3 flow with timeouts and retry (one
  automatic retry).
- **Process:** `dgram`/`net`/`http` run in the **main process**; the UI talks
  over IPC (follow the IPC pattern `app.compressed.js` already uses for
  serialport).
- Generator wrapper: `arduino_wifi_wrapper.js` (§2.4), applied when the
  target is WiFi.
- UI in `views/main.html` + `app.compressed.js`:
  - A **"Send via WiFi"** button next to the USB and BLE uploads.
  - A **robot picker**: a modal listing discovery responses (name, IP,
    battery, fw) with refresh and cancel — fixing the BLE branch's P2
    backlog at the root.
  - A progress bar with phases (compiling / converting / uploading /
    flashing / rebooting).
  - A settings dialog: robot name and WiFi credentials (`setname`/`setwifi`).
- New strings in pt-BR **and** en (the fork has a pt-BR locale in
  `blockly-core/msg/scratch_msgs.js`).

### Phase 4 — Telemetry over TCP

- Point the existing telemetry dashboard at the TCP source: send
  `telemetry on` on connect, same frame parsing as today. Add a source
  selector (BLE/WiFi) where the app currently picks BLE.
- Goal: a stable ≥10 Hz with every sensor, with no visible loss over 10
  minutes (there is plenty of bandwidth headroom; the limit is the firmware
  poll).

### Phase 5 — Tests and tooling

- `tools/stress_upload_wifi.py` (adapted from the BLE branch's
  `tools/stress_upload.py`): N consecutive OTA uploads, measuring time and
  success rate. Goal: **20/20 uploads** of a sketch ≥100 KB.
- Playwright e2e test (following the `test_app.js` pattern): open the app →
  the WiFi button is visible → the picker opens → error states (no robot
  found) render.
- Update `README.md` (feature section) and `CHANGELOG.md`, and create
  `docs/WIFI_UPLOAD.md` (end-user guide: how to set up the classroom network,
  AP mode, BTN_UP recovery, troubleshooting).

---

## 4. Known risks and workarounds

1. **Plain HTTP in `ota.download()`** — risk number one; this is why Phase 0
   exists. Plan B is described there.
2. **OTA in AP mode** — unknown number two; verify in Phase 0. Worst case:
   OTA requires station mode (a phone hotspot solves it in the classroom or
   the pit) and AP is left for telemetry/discovery.
3. **Flash/RAM** — without the VM there is more room than on the BLE branch,
   but measure in Phase 0 and print the usage in the UI's build log (the fork
   already has a "footer size bar"; reuse it).
4. **Windows Firewall** — the first `dgram`/`http` call from Electron
   triggers the firewall prompt; document it in the user guide and detect a
   discovery timeout with an explanatory message.
5. **The robot disappears after a user sketch hangs** — covered by BTN_UP
   recovery mode (Phase 2; it is a requirement, not an option).
6. **Competition rules** forbid wireless during scoring runs — this feature
   is for the pit, practice and the classroom; make that clear in
   `docs/WIFI_UPLOAD.md` and offer a "radio off" block or toggle.
7. **Do not use** `WiFiS3` and `ArduinoBLE` in the same sketch (shared modem).
8. **MQTT stays out of this branch** — multi-robot telemetry through a broker
   ("teacher mode") is a separate future feature; the TCP protocol here must
   not preclude it (hence typed NDJSON with `"t"`).

## 5. Branch acceptance criteria

- [ ] An OTA upload of a Blockly program with **more than 2000 blocks**
      (impossible on the VM) works end to end.
- [ ] Total "click → robot running" time ≤ 60 s (dominated by compilation,
      not by the network).
- [ ] 20/20 consecutive uploads without failure (stress test).
- [ ] Two robots powered on simultaneously: the picker tells them apart and
      uploads to the right one.
- [ ] A robot with a hung sketch is recovered via BTN_UP + a new OTA (no USB).
- [ ] Telemetry at ≥10 Hz for 10 minutes without dropping.
- [ ] The original USB upload still works untouched.
- [ ] `node patch_asar.js` and `node test_app.js` pass; docs updated.

## 6. References

- Official OTA example: `github.com/arduino/ArduinoCore-renesas` →
  `libraries/OTAUpdate/examples/OTA/OTA.ino`
- Reference `.ota` tooling: `github.com/arduino/ArduinoIoTCloud` →
  `extras/tools/bin2ota.py` and `lzss.py` (or `arduino-cloud-cli ota encode`)
- Analysis of the BLE/VM limitations:
  `arduino/libraries/MatrixMiniR4/examples/6-VM Runtime/SESSION_2026-07-18_ALWAYS_ON_BLE.md`
  (branch `feature/always-on-ble-runtime`)
- Reference BLE wrapper:
  `.../6-VM Runtime/ide_patch/blockly-core/arduino_ble_wrapper.js` (same branch)
- Rejected alternative (half-the-flash limit): `github.com/JAndrassy/ArduinoOTA`
