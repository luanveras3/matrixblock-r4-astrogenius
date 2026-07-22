# Handoff — Remaining Work on feature/wifi-tcp-ota

> **Audience**: an AI agent (Claude Opus or similar) or human developer
> implementing the next phases **without access to the conversations that
> produced this branch**. Self-contained: current state, environment map,
> per-task implementation guides, and every hardware/session gotcha learned
> during the 2026-07-22 implementation + hardware-validation sessions.
>
> Read `MANUAL_WIFI_TCP_OTA.md` first for the original architecture and
> protocol spec, then this file for what is DONE, what CHANGED vs. that
> manual, and what remains.

---

## 1. Current state (as of commit `b9000a9`)

Everything below is implemented, hardware-validated on a real hub, and
pushed to `feature/wifi-tcp-ota`:

- `tools/bin2ota.js` — .bin → .ota converter, byte-identical to Arduino's
  official encoder (test suite `tools/bin2ota.test.js`, 19 checks, includes
  re-encoding the official `UNOR4WIFI_Animation.ota` fixture to byte
  equality). `tools/lzss_ref.py` is an independent Python cross-check.
- Firmware `arduino/libraries/MatrixMiniR4/src/Modules/MiniR4WiFiRuntime.{h,cpp}` —
  STA + AP fallback, UDP discovery :47801, TCP NDJSON commands :47802, OTA
  via the core's OTAUpdate library, telemetry (82-byte frames, base64 in
  `{"t":"tm","d":...}`), BTN_UP recovery mode, config in dataflash block 6
  (magic `MBRW`, includes cached MAC at offsets 126..127). AP SSID is
  `<custom name>-<mac4>` (or `MBR4-<mac4>` unnamed). `setwifi` with empty
  ssid clears stored credentials. AP password is configurable
  (`setappass`, 8..63 chars, empty = default `matrix2026`);
  `{"t":"reboot"}` restarts the hub remotely; `{"t":"factory"}` wipes the
  config record — same effect as the no-IDE gesture BTN_UP + BTN_DOWN held
  at power-on. Config record is 192 bytes (AP password at offsets
  128..191; older 128-byte records read back as "default password").
- IDE `resources/app_src/blockly-core/wifi_upload.js` (button, robot picker,
  settings dialog, OTA progress UI, EN + pt-BR) and
  `arduino_wifi_wrapper.js` (wraps every compiled sketch with the runtime;
  tested by `tools/wifi_wrapper.test.js`).
- `patch_asar.js` can add files that don't exist in the pristine asar.
- Docs: `docs/WIFI_UPLOAD.md` (user guide), `docs/POC_OTA_FINDINGS.md`
  (all Fase 0 hardware findings — READ IT, it has measured numbers).

Hardware validation summary (one hub, all in AP mode): bridge firmware
0.6.0 works as-is; 140 KB sketch OTA in ~4 s download + 4 ms verify;
**5 consecutive OTA rounds with zero transport failures**, including
runtime→runtime through the real TCP product path; telemetry sustained
9.0–9.4 Hz (see §5 note); two field bugs found and fixed (MAC-zeros
identity, STA→AP socket wedge — settle delays are load-bearing, do not
remove them).

The test hub currently runs the latest runtime, is named `MATRIX-AG1`,
broadcasts AP `MATRIX-AG1-B0BC` (password `matrix2026`), and has no stored
network credentials.

## 2. Environment map (critical — two trees, easy to confuse)

| Path | Role |
|---|---|
| `C:\dev\matrixblock-r4-astrogenius` | **The git checkout** (a whitelist-based delta). Commit/push here. |
| `C:\matrixblock-r4` | The **installed app** (Electron exe, `resources/app.asar`, full arduino toolchain at `arduino\`). NOT a git repo. |
| `C:\matrixblock-r4\arduino\libraries\MatrixMiniR4` | The **live library** the compiler uses. Firmware edits go HERE, then are mirrored (copied) into the git tree. |
| `C:\matrixblock-r4\backup_pre_wifi_tcp_2026-07-22\` | Pre-feature backups (BLE-era app.asar + library). |

Rules that bit us — follow them:

- **asar rebuild**: from the git tree run `node patch_asar.js` with env vars
  `ASAR_BACKUP=C:/matrixblock-r4/resources/app.asar.original.bak`,
  `ASAR_OUT=C:/matrixblock-r4/resources/app.asar`,
  `ASAR_SRC_DIR=C:/dev/matrixblock-r4-astrogenius/resources/app_src`.
  The defaults inside patch_asar.js point at paths that don't exist.
  The IDE must be CLOSED (Windows locks app.asar). Verify afterwards with
  `node test_app.js` (Playwright smoke test, expects 0 console errors).
- **.gitignore is whitelist-model with traps**: un-ignoring a directory
  un-ignores its whole subtree (a full untracked copy of the stock library
  sits in the git tree — a careless `git add arduino/libraries` once staged
  324 files). Every new file under `resources/app_src/` or
  `arduino/libraries/` needs its own `!` line or `git add` silently skips
  it. Check `git status --short` output carefully after staging.
- **PowerShell tool**: `git commit -m @'...'@` here-strings get mangled —
  write the message to a temp file and `git commit -F <file>`. Prefer
  ASCII-safe punctuation in commit messages.
- New app_src files must ALSO be added to the `PATCHES` array in
  `patch_asar.js` and given a `<script>` tag in `views/main.html`.

## 3. Hardware / network session gotchas (READ BEFORE TOUCHING THE HUB)

- Hub is on **COM10**. `arduino-cli` must run with cwd
  `C:\matrixblock-r4\arduino` and `--config-file .\arduino-cli.yaml`
  (the yaml uses relative data dirs). FQBN `arduino:renesas_uno:unor4wifi`.
- Serial: open with .NET `System.IO.Ports.SerialPort`, `DtrEnable=$true`.
  Opening does NOT reset the R4 — if the sketch already booted you missed
  its prints; send a command instead. The PoC sketch
  (`docs/poc/OTA_POC/`) blocks in `while (!Serial)` until a port opens.
- Debug traces: compile with
  `--build-property "build.extra_flags=-DMINIR4_WIFI_RUNTIME_DEBUG"` and a
  sketch that calls `Serial.begin` (see WIFIRT_TRACE in the runtime).
- **Windows Firewall**: the robot-AP network lands on the **Public**
  profile. The Microsoft-Store Python has no Public inbound rule → serving
  a file with `python -m http.server` fails with OTA error **-6**
  (ServerConnectError, from the Arduino_ESP32_OTA enum — the RA4M1-side
  OTAUpdate propagates modem errors). **node.exe has Public allow rules**
  on this machine — serve with node. The Electron IDE needs its firewall
  prompt accepted on first upload.
- **DHCP dance**: after joining a robot AP, Windows often keeps an APIPA
  (169.254.x.x) lease. Fix: `netsh wlan disconnect`, wait 2 s, reconnect,
  wait ~12 s. Ping 192.168.4.1 to confirm (robot always = 192.168.4.1 in
  AP mode; PC gets 192.168.4.2).
- The PC's WiFi radio may be soft-off (`netsh wlan show interfaces` →
  "software Desativado"); it can be enabled via the WinRT Radio API from
  PowerShell (RequestAccessAsync → SetStateAsync('On')).
- WLAN profiles are created with an XML file + `netsh wlan add profile`.
  AP password is `matrix2026`. Robot AP SSID changes when the user renames
  the robot (next power-cycle) — re-scan (`netsh wlan show networks`)
  before assuming the old SSID.
- OTA error codes come from `Arduino_ESP32_OTA::Error` (see
  `docs/POC_OTA_FINDINGS.md` §1 for the http/WiFiClient details): -6
  server connect, -10 header CRC, -11 magic, -12 download.

## 4. TASK: Fase 4 — telemetry HUD in the IDE (the main remaining feature)

**Goal**: the dashboard/HUD that the BLE branch shows (robot sidebar with
battery, IMU, buttons, motors, analog/digital ports, I2C sensors, DHT)
fed from the WiFi TCP stream instead of Web Bluetooth.

**Where the reference implementation lives** (BLE branch — reference ONLY,
do not modify that branch):

```
git show 'feature/always-on-ble-runtime:arduino/libraries/MatrixMiniR4/examples/6-VM Runtime/ide_patch/blockly-core/ble_upload.js' > ble_upload.js
```

That 2,542-line file contains, besides the BLE transport: the HUD tab bar
(Code/HUD/Log tabs injected above `.console-Div`), the sidebar DOM, the
**82-byte telemetry frame parser**, per-port picker UI (phase 3a/3b/3c),
DHT opt-in logic, and the i18n table. Roughly lines 640–2,300 are
transport-agnostic UI worth porting nearly verbatim.

**The WiFi source is already prepared**:

- `wifi_upload.js` exposes `window.MBR4WiFi.RobotClient` (NDJSON TCP
  client) and `discover()`. Connect, send
  `{"t":"telemetry","on":true,"hz":10}`, then every `{"t":"tm","d":"..."}`
  frame is the SAME 82-byte blob the BLE parser reads — just
  base64-decode `d` first (`Buffer.from(o.d, 'base64')` / `atob`).
- Frame layout (documented in `MiniR4WiFiRuntime.cpp` `_pollTelemetry`):
  offset 0 = tag 0xA2; 1..2 battery mV/10 (u16 LE); 3..8 VM fields —
  **always zero on this branch** (HUD should hide the VM/Program section);
  9..14 roll/pitch/yaw (i16 LE ×100); 15 buttons; 16..19 uptime s (u32);
  20..35 encoders M1..M4 (i32); 36..47 A0..A5 (u16); 48..49 digital
  bitfield; 50..53 laser I2C1/2 (u16 mm, 0xFFFF=n/a); 54..61 DHT D1..D4
  (i8 temp, u8 hum; 127/255=n/a); 62..69 color I2C1/2 (RGB + id);
  70..73 laser I2C3/4; 74..81 color I2C3/4.
- The DHT opt-in command on this branch is `{"t":"dht","mask":N}` (bit N =
  port D(N+1)) — same semantics as BLE's CMD_ENABLE_DHT.

**Suggested implementation**:

1. New file `resources/app_src/blockly-core/wifi_hud.js` (keeps
   wifi_upload.js from doubling in size). Port the HUD DOM/tabs/parser
   from ble_upload.js, replacing the BLE session with a persistent
   `RobotClient` connection + auto-reconnect (discovery → connect → enable
   telemetry; retry every ~5 s while the HUD tab is visible).
2. Register it: `PATCHES` in patch_asar.js, `<script>` tag in main.html
   after wifi_upload.js, `!` line in .gitignore.
3. Keep the strings bilingual EN + pt-BR (copy the BLE i18n table — it
   already has both locales; drop VM-specific strings).
4. A "connect/disconnect" affordance in the HUD (pick robot via the
   existing discovery picker; remember last robot by mac in localStorage).
5. Rebuild asar + `node test_app.js` + a Playwright probe (see
   `wifi_probe.js` in the git-tree root for the pattern; probes are
   intentionally untracked).

**Definition of done**: HUD tab shows live battery/IMU/buttons/uptime from
a real hub over WiFi at the streamed rate for 10 minutes without
disconnect (auto-reconnect allowed); ports sub-tab works incl. DHT opt-in;
USB and BLE branches untouched.

## 5. TASK: Fase 5 — acceptance runs (hardware, mostly procedural)

- **Stress 20/20**: `python tools/stress_upload_wifi.py <sketch.ota> 20`
  — but NOTE the firewall finding: its built-in Python HTTP server will be
  blocked on the robot-AP (Public) network on this machine. Either allow
  Python inbound (user action), or run on a Private-profile network, or
  adapt the script to accept an external server URL and serve with node.
  Generate the payload with `node tools/bin2ota.js`. Target: 20/20, sketch
  ≥100 KB (the runtime example itself, 140 KB, is a fine payload).
- **Two robots**: needs a second hub (ask Luan). Flash the runtime example
  via USB, verify both appear in the picker (distinct mac4/names), upload
  to one, confirm the other is untouched.
- **BTN_UP recovery**: needs a human hand — hold BTN_UP while powering on;
  OLED must show "OTA MODE" + IP; send any OTA; confirm the hub returns
  running the new sketch. Also flash a deliberately-blocking sketch
  (`while(1){}` in setup, bypassing the wrapper via a raw .ino) first to
  prove the rescue story end to end.
- **Telemetry endurance**: 10 min stream. Expectation: **9.0–9.4 Hz**
  sustained when hz=10 is requested — NOT 10. The synchronous modem write
  costs ~100 ms per frame round-trip; this is a platform ceiling, already
  documented in POC_OTA_FINDINGS.md (the BLE dashboard polls at 5 Hz, so
  9+ is ~2× the existing UI cadence). Do not burn time chasing 10 unless
  batching frames (send 2 frames per write) turns out trivial.

Record all results in `docs/POC_OTA_FINDINGS.md` (append an acceptance
section) and tick the criteria list at the end of `MANUAL_WIFI_TCP_OTA.md`.

## 6. TASK: release

Tag `vX.Y-stable` on the branch (after merge to master, or on the branch if
shipping a beta to the team) → GitHub Actions
(`.github/workflows/release.yml`) fetches the pristine asar from the
private vendor repo (repo vars `BAK_REPO`/`BAK_TAG`/`BAK_ASSET`, secret
`BAK_REPO_TOKEN`) and attaches the patched `app.asar` to the release.
Users install by file swap (see `INSTALL.md`). The firmware side ships as
library sources — users get it because every IDE compile embeds the
runtime; hubs need one USB flash (or one OTA from an already-runtime hub).

Per team convention: do NOT announce every increment to Rose (MATRIX
Robotics) — batch this feature with other accumulated upgrades in one
message, and only after acceptance passes.

## 7. TASK (roadmap R2, optional): bytecode VM over TCP

The user wants the trio: WiFi OTA (done) + WiFi VM (instant iteration) +
USB. Constraints and pointers:

- The VM itself (`MiniR4VM.{h,cpp}`, 77 opcodes) and the IDE bytecode
  generator live on `feature/always-on-ble-runtime` (lib `src/Modules/` and
  `examples/6-VM Runtime/ide_patch/blockly-core/` — `bytecode.js`,
  `generator_bytecode/`). The VM is transport-agnostic; only
  MiniR4BLERuntime drives it. **ArduinoBLE must NOT be linked here** (modem
  conflict) — port the VM by adding a `{"t":"vm_*"}` command family to
  MiniR4WiFiRuntime (start/chunk/end/run/stop/erase, mirroring the BLE
  CMD_ enum semantics; payload chunks base64 in NDJSON).
- Budget check before committing: WiFi runtime example is 140 KB / 53%
  flash, 56% RAM; the BLE branch measured the VM at roughly +27 KB flash.
  Compile early, watch RAM (dataflash blocks 1..6 are free on this branch
  for bytecode storage — same layout as BLE — but keep block 6 clear:
  it now holds the `MBRW` config! Use blocks 1..5, cap programs at 5 KB,
  or move the config; decide explicitly and document).
- IDE side: the bytecode compiler is loadable as-is; add a "fast send"
  button that compiles via `Blockly.BytecodeVM.compile(workspace)` and
  streams over the existing RobotClient. At ~36 KB/s effective, a 6 KB
  program lands in well under a second.
- The 6 KB/handler-coverage limits of the VM still apply — position it as
  the classroom fast-iteration mode, with OTA as the "real program" path.

## 8. Known open items / debts

- `wifi_upload.js` duplicates the LZSS encoder from `tools/bin2ota.js`
  (documented at both sites). If you touch the format, change BOTH and run
  `node tools/bin2ota.test.js`.
- Discovery "batt" reports ~0.40 V when USB-powered (no battery) — the HUD
  should render that as "USB/no battery", not 0.4 V.
- Telemetry `hz` is clamped 1..50 in firmware but real ceiling is ~9.4 —
  consider clamping to 10 in the IDE UI.
- `MANUAL_WIFI_TCP_OTA.md` §1.1 dataflash map is stale (written before the
  BLE fused-config revamp); the authoritative map is in
  `MiniR4WiFiRuntime.h`'s header comment.
- Probe scripts (`wifi_probe.js`, `wifi_finish_probe.js`, `*_probe.js`) are
  deliberately untracked local tooling — keep it that way.
