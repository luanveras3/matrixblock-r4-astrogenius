# Session 2026-07-18 -- Always-on BLE runtime + IDE compiler

Snapshot of the work done in the 2026-07-18 session. The goal was to make the
BLE runtime **always available** on any USB-uploaded sketch, so once a MATRIX
Mini R4 is flashed one time the student can iterate wirelessly. Also added a
Blockly -> bytecode compiler inside the MATRIXblock IDE and a Web Bluetooth
uploader, so a click in the IDE compiles + sends bytecode over BLE.

Everything below was written and tested against the local checkout. The
final piece -- a real R4 responding at `MATRIX-R4-Runtime` after being
flashed with a wrapped sketch -- is **still unverified on hardware** (see
"Open issues" at the bottom).

## New architecture

    +------------------------ MATRIX Mini R4 firmware ---------------------+
    |                                                                     |
    |   setup():   userSetup()                                            |
    |              BLERuntime.begin()   <-- loads bytecode from dataflash |
    |                                       + starts ArduinoBLE           |
    |                                                                     |
    |   loop():    BLERuntime.poll()    <-- BLE + VM step                 |
    |              if (!isRunningVM())                                    |
    |                  userLoop();      <-- your compiled code runs       |
    |                                       WHEN no bytecode is stored    |
    +---------------------------------------------------------------------+

Modes:
- **Native**: dataflash empty. `isRunningVM()` = false. `userLoop()` runs
  normally, BLE keeps advertising.
- **VM**: dataflash has an `MBR4`-magic header. `isRunningVM()` = true.
  `userLoop()` is skipped; VM executes the stored bytecode until HALT.

Switching between modes:
- **Native -> VM**: the IDE (or `miniR4_client.py`) sends START/CHUNK/END/RUN
  over BLE. The runtime writes the bytecode to dataflash block 1..4, loads
  it into the VM, and starts stepping. Next reboot keeps the program.
- **VM -> Native**: BLE `CMD_ERASE` (0x06) wipes block 1. `hasStoredProgram()`
  returns false; user code takes over next tick.
- **Kill switch**: hold `BTN_UP + BTN_DOWN` together for 3 seconds. The
  persistent BLE-enable flag in dataflash block 5 flips. LED1 flashes green
  3x if BLE was just enabled, red 3x if disabled. The change takes effect
  on next reboot (BLE stack cannot be flipped cleanly mid-run).

## Files delivered

### Firmware library (`src/Modules/`)

- **`MiniR4BLERuntime.h`** -- public API. `BLERuntime` singleton exposed via
  `extern` for use in user sketches or wrapped sketches.
- **`MiniR4BLERuntime.cpp`** -- implementation. Refactor of the standalone
  `MiniR4_BLE_Runtime.ino` into a class, with the persistent enable flag
  and the button-gesture toggle added. Protocol, LED indicator, and
  dataflash layout are unchanged.

Dataflash map used:
- Block 0 (bytes 0..1023): reserved for vEEPROM lib (IMU calibration).
  Untouched.
- Blocks 1..4: bytecode program storage (4 KB max).
- Block 5: BLE-enable flag (`0xFF`=enabled, `0x00`=disabled).
- Blocks 6..7: free for future use.

### Standalone runtime sketch

- **`examples/6-VM Runtime/MiniR4_BLE_Runtime/MiniR4_BLE_Runtime.ino`** --
  rewritten from ~300 lines down to ~10, delegating everything to
  `BLERuntime`. Kept as a reference / bare-metal testbed. **Most users
  won't need to flash this** because the IDE now wraps every USB sketch
  with the same runtime.

### MATRIXblock IDE patch (`examples/6-VM Runtime/ide_patch/`)

All additive; the existing USB compile/upload path is untouched.

- **`blockly-core/bytecode.js`** -- Blockly generator `Blockly.BytecodeVM`
  that emits MiniR4VM opcodes. Includes a two-pass label-resolving
  assembler and a payload-size cap of 4 KB (dataflash limit). 77 opcodes
  in the table.
- **`blockly-core/generator_bytecode/{control,data,math,operators}.js`** --
  the first slice of block handlers. Covers control flow, variables (16
  slots), integer math, comparisons, and logical ops. Unsupported blocks
  (`operator_mathop`, string ops) call `Blockly.BytecodeVM.warn()` so the
  compile still succeeds; the console lists what was skipped. **Hardware
  blocks (LED, motor, sensor) are NOT yet emitted** -- that is task #5,
  still pending.
- **`blockly-core/arduino_ble_wrapper.js`** -- post-processes
  `Blockly.Arduino.finish()` so every USB-compiled sketch becomes:

        #include "MatrixMiniR4.h"
        #include "Modules/MiniR4BLERuntime.h"
        <user's includes / defines / functions>
        static void userSetup() { <original setup body> }
        static void userLoop()  { <original loop body>  }
        void setup() { userSetup(); BLERuntime.begin(); }
        void loop() {
          BLERuntime.poll();
          if (!BLERuntime.isRunningVM()) { userLoop(); }
        }

  Idempotent (if the source already mentions `MiniR4BLERuntime`, passes
  through). Gracefully falls back to unwrapped output if `setup()` /
  `loop()` cannot be located.

- **`blockly-core/ble_upload.js`** -- Web Bluetooth uploader. Adds two
  nav buttons next to the existing USB Upload:
    - **Conectar / Desconectar** -- opens/closes a persistent GATT session
      with `MATRIX-R4-Runtime`. Icon color: grey = disconnected, green =
      connected. Reacts to `gattserverdisconnected` events.
    - **Enviar via BLE** -- compiles the current workspace and streams
      bytecode via the open session. If not connected, prompts to connect
      first. If compile produces `<= 1` byte, warns that all blocks are
      unsupported (hint to use USB upload instead) and lists which block
      types have no `BytecodeVM` handler yet.
  - Sanity ping: right after Connect, sends `CMD_INFO` and expects a
    `STATE` reply within 3s. If none arrives, disconnects and warns the
    user that the R4 accepted the connection but isn't running the runtime
    protocol.
  - Write timeout: 5s cap on every `writeValueWithResponse` so a hung BLE
    stack surfaces an error instead of hanging forever.
  - Floating overlay: mirrors every `[BLE]` log line to a fixed
    bottom-right panel so the user sees progress even if the code-Div
    panel is collapsed. All logs also go to browser `console.log`.
  - i18n: bilingual EN + pt-BR strings, no accents in pt-BR (avoids
    PowerShell/CP1252 encoding issues in the build pipeline).

- **`blockly-core/_BlocksAutoLoad.js`** -- extended loader. After the
  existing Arduino generators, it loads:
    1. `arduino_ble_wrapper.js` (post-processes `Blockly.Arduino.finish`)
    2. `bytecode.js` + all `generator_bytecode/*.js`
    3. `ble_upload.js` is loaded via a `<script>` tag injected into
       `main.html` (see `build.ps1`).

- **`build.ps1`** -- idempotent packager. Extracts `resources/app.asar` to
  a temp tree, overlays the patch files, injects one `<script>` tag into
  `views/main.html`, injects a `select-bluetooth-device` handler and
  auto-selector for `MATRIX-R4-Runtime` into `main.js`, then repacks.
  Backs up the original asar to `app.asar.pre-ble.bak` on first run.
  Pure ASCII on purpose -- PowerShell 5.1 misreads UTF-8 no-BOM `.ps1`
  files as CP1252 and mangles the parser (see the corresponding
  feedback memory entry).

- **`README.md`**, **`test/*.js`**, **`e2e/*.js`** -- documentation, unit
  tests (Node standalone), and Playwright end-to-end tests. All green
  at session close (57 total assertions).

## Testing done

    node ide_patch/test/test_assembler.js       # 12/12 assembler primitives
    node ide_patch/test/test_handlers.js        # 7/7 handler integration
    node ide_patch/test/test_wrapper.js         # 9/9 Arduino wrapper
    node ide_patch/e2e/test_ide.js              # 29/29 E2E in real IDE
    node ide_patch/e2e/test_full_pipeline.js    # IDE -> arduino-cli compile

The full-pipeline test proves: a blockly workspace ->
`Blockly.Arduino.workspaceToCode` (through the wrapper) -> `.ino` file ->
`arduino-cli compile` -> valid firmware. Numbers on a minimal sketch:
- Flash: 126,904 / 262,144 bytes (48%)
- RAM: 20,832 / 32,768 bytes global (63%). About 12 KB free for locals.

## Install / rollback

Install:

    powershell -File "examples/6-VM Runtime/ide_patch/build.ps1"

Close MATRIXblock first (Windows locks `app.asar` while the app is
running). The script backs up the pre-BLE asar to
`resources/app.asar.pre-ble.bak` on first run.

Rollback:

    Copy-Item -Force resources/app.asar.pre-ble.bak resources/app.asar

## Open issues (unfinished work)

### 1. R4 not advertising `MATRIX-R4-Runtime` after wrapped USB upload

This is the main open thread from the session. User compiled a sketch
through the patched IDE and uploaded via USB, but scanning for BLE
devices from a phone does not surface `MATRIX-R4-Runtime`.

Possible causes to investigate next session:

- `ArduinoBLE` library not installed on the local `arduino/libraries`
  path. `arduino-cli` may resolve it from the platform-provided folder
  when compiling on this machine, but if the user's sketch didn't
  actually go through the local wrapper (e.g. IDE was compiled
  differently), `BLE.begin()` would silently fail at runtime.
- The IDE-side compile might route USB uploads through a code path we
  didn't intercept -- `Blockly.Arduino.finish` is the standard hook, but
  MATRIXblock might have its own `finish` or an alternate emitter.
- `MiniR4.begin()` in `userSetup()` may need a specific mode argument;
  the wrapper hardcodes nothing but relies on the user's blocks emitting
  `MiniR4.begin(N)`. If the user's sketch calls it without a valid mode,
  BLE hardware init could fail.
- Wrapper skipped due to idempotency check: if the generated string
  already contains "MiniR4BLERuntime" (unlikely, but possible via a
  cached older upload), it passes through unmodified.

Suggested next session start:
1. Compile a trivial "blink" sketch through the patched IDE, then
   inspect the raw C++ it produces (there's a code-Div panel in the
   IDE, or export via the AstroGenius "Export as .ino" feature).
2. Confirm the emitted `.ino` starts with the wrapper markers.
3. If wrapper is present but BLE still doesn't advertise, add a
   Serial-print in `MiniR4BLERuntime::begin()` and flash again to see
   whether it is called.

### 2. Hardware block handlers not emitted in BytecodeVM (task #5)

The bytecode generator currently only emits for control/data/math/
operators. All GPIO, LED, motor, servo, IMU, sensor blocks silently
produce nothing. Users see the "compile is trivial (1 byte)" warning
in the console but that's the only feedback. Task #5 in the session
task list is dedicated to this and remains pending.

Coverage after task #5 should hit ~62% of the 193 registered blocks
(per `BLOCK_OPCODE_MAP.md`).

### 3. The "7 bytes" mystery

User reported a compile output of 7 bytes for a single `control_wait`
block. Local reproduction with the same bytecode.js produces 11 bytes
(2+3+1+1 for the wait, +3 for J:main, +1 for HALT). Possibly a
mis-reading of the log by the user, or a stale cached version of
bytecode.js was still active. Worth verifying next session by having
the user paste the exact log line.

## Memory updates during the session

- `feedback_powershell_text_edits.md` -- extended with two new lessons:
  (a) `.ps1` files must be pure ASCII to survive PowerShell 5.1's
  CP1252 misinterpretation of UTF-8 no-BOM; (b) PowerShell variables
  are case-insensitive so `$MainJs` and `$mainJs` are the same
  variable, and clobbering the path with content produces "invalid
  characters in path" as an error.

Both saved into the persistent memory system.

## What still lives outside git

- `C:\matrixblock-r4\resources\app.asar` (the patched IDE binary, ~115 MB)
- `C:\matrixblock-r4\resources\app.asar.pre-ble.bak` (the pre-patch
  backup, ~113 MB)
- These are intentionally left out of the repo -- the source of truth
  is `ide_patch/` and `build.ps1` reconstructs the asar on demand.
