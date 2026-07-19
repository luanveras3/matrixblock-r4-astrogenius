# Session 2026-07-18 -- Always-on BLE runtime + IDE compiler

Snapshot of the work done in the 2026-07-18 session. The goal was to make the
BLE runtime **always available** on any USB-uploaded sketch, so once a MATRIX
Mini R4 is flashed one time the student can iterate wirelessly. Also added a
Blockly -> bytecode compiler inside the MATRIXblock IDE and a Web Bluetooth
uploader, so a click in the IDE compiles + sends bytecode over BLE.

Everything below was written and tested against the local checkout.

**End-of-day update (later on 2026-07-18):** the full chain is now
validated on real hardware. Workspace -> wrapped .ino -> USB upload ->
R4 boots BLE runtime -> IDE Connect -> Enviar via BLE -> R4 executes.
See the "Verified end-to-end" section near the bottom for the exact
scenarios covered and the two known bugs still open.

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

**RESOLVED 2026-07-18 (later session):** the runtime was working the
entire time. Root cause: **the user was scanning with the phone's
built-in Bluetooth settings screen**, which does not surface raw BLE
peripherals (only classic pairing-capable devices). Confirmed
end-to-end with nRF Connect on the same phone -- `MATRIX-R4-Runtime`
appears immediately.

Also confirmed on the way to that conclusion:

- Wrapper output inspected: emits correct `.ino` with `BLERuntime.begin`
  + `BLERuntime.poll` (unit tests + live simulation both pass).
- Extracted `resources/app.asar` confirms wrapper, uploader, autoload,
  and main.js bluetooth handler are all packaged.
- `arduino-cli compile --config-file ./arduino-cli.yaml` resolves
  `MatrixMiniR4 1.2.2` and `ArduinoBLE 1.5.0` from local
  `arduino/libraries/` (NOT the user's OneDrive Arduino sketchbook).
  End-to-end compile clean at 134 KB / 51 % flash, 20 KB RAM.
- Instrumented `MiniR4BLERuntime.cpp` with `MINIR4_BLE_RUNTIME_DEBUG`
  macro-guarded Serial checkpoints. Real R4 output shows
  `bleStackUp=YES bleEnabled=YES` at every heartbeat -- HCI stack is
  live.
- Modem firmware reads `0.6.0` (newer than the `WIFI_FIRMWARE_LATEST_VERSION`
  string of `0.5.2` compiled into WiFiS3), so it's not a stale modem.
- Split adv/scan-response payload change made (see below); the 128-bit
  service UUID and the local name no longer compete for the 31-byte
  ADV budget. Even with the fix nothing shows on scan under USB power.

HCI trace captured with `HCI.debug(Serial)` and reviewed manually --
LE Set Advertising Enable ON returns status 0x00 and the modem
manufacturer field reads 0x0060, so the ESP32-S3 firmware really is
serving the standard HCI protocol. The gap between "HCI says success"
and "phone shows the device" was entirely the scanner app.

Next-session action: the "always-on BLE runtime" work item is done.
Move on to task #5 (bytecode handlers for hardware blocks) and add a
user-facing note to the IDE README / troubleshooting text steering
students to nRF Connect (or the IDE's own "Conectar via BLE" button)
instead of the OS Bluetooth settings.

Deprecated hypotheses that were disproven this session (do NOT reopen):

- ~~`ArduinoBLE` library not installed on the local `arduino/libraries`~~
- ~~The IDE-side compile might route USB uploads through a code path we didn't intercept~~
- ~~`MiniR4.begin()` in `userSetup()` may need a specific mode argument~~
- ~~Wrapper skipped due to idempotency check~~

Also fixed this session:

- **Split advertising payload.** The old init put both the 128-bit
  service UUID and the "MATRIX-R4-Runtime" local name in the ADV PDU,
  which overflows the 31-byte limit and the name gets truncated by
  ArduinoBLE. The runtime now uses `setAdvertisingData(advData)` for
  the name and `setScanResponseData(scanResp)` for the service UUID,
  each staying under 31 bytes. Preserved in `MiniR4BLERuntime.cpp`.
- **`isBLEStackUp()` public accessor** on `MiniR4BLERuntimeClass`.
  Reports the local `_bleActive` flag so sketches can distinguish
  "persistent enable flag on" from "HCI stack initialised". Useful for
  smoke tests only; it cannot detect the missing-RF-power condition.
- **`MINIR4_BLE_RUNTIME_DEBUG` macro** in `MiniR4BLERuntime.cpp`.
  Define it in the sketch (before including `MatrixMiniR4.h`) to get
  `[BLERT]` Serial checkpoints inside `begin()`. Zero overhead when
  undefined.

Diagnostic sketch kept at `C:\Users\luanh\AppData\Local\Temp\ble_smoke\ble_smoke.ino`
(not in the repo -- scratch file).

Windows-specific Serial gotcha discovered while debugging: PowerShell's
default `System.IO.Ports.SerialPort` has `DtrEnable = false`, and the
RA4M1 native USB CDC only flushes TX when the host asserts DTR. Set
`$port.DtrEnable = $true` (and `$port.RtsEnable = $true` for good
measure) before opening, or the port appears silent. Applies to any
future PowerShell-based serial capture.

--- ORIGINAL analysis kept for historical reference ---

Original suspects when this section was first written (all disproven by
the debug above):

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

**Update 2026-07-18 (later session): DONE.** Added
`generator_bytecode/_mini.js` and `generator_bytecode/pins.js`, each
covering the block IDs listed in `BLOCK_OPCODE_MAP.md`. New handler
count: LED (2), buzzer (3), motors (7), servos (2), IMU (4), buttons
(1), OLED (4), timer (1), power (1), Matrix D/A shorthand (3 warn-
only), GPIO pins (8) = ~36 hardware handlers total.

Ultrasonic (`mini_USget`) and the Matrix D/A port shorthands warn and
fall through until the compile-side pin table is populated -- they
need `MMLower.h` pin routing exposed to JS or a hard-coded lookup that
mirrors the C header. Also skipped: DriveDC blocks, OLED string
print (needs the string subsystem in `BLOCK_OPCODE_MAP.md` §6), and
any HuskyLens / Grove I2C sensor. Everything else in the map's ✅
column now compiles.

Tests added: `ide_patch/test/test_hardware_handlers.js` (25 asserts).
Combined with the existing suites: 12 (assembler) + 7 (handlers) + 9
(wrapper) + 25 (hardware) = **53 total asserts, all green**.

The `_BlocksAutoLoad.js` file was extended with `_mini` and `pins` in
`BytecodeFiles` so the loader picks them up. `build.ps1` was
unchanged -- the glob `generator_bytecode\*` already sweeps in any new
handler file.

### 3. The "7 bytes" mystery

**RESOLVED (later 2026-07-18).** The mystery is now moot -- the actual
observed count on the real R4 is what MATRIXblock produces after the
`mini_setup` SUBSTACK2 fix (see item 4) plus the ms-vs-seconds fix in
`control_wait` (item 5). Nothing to chase.

### 4. `mini_setup` swallowed the entire program

The Blockly.BytecodeVM handler for `mini_setup` only forwarded
`SUBSTACK` into `_setupCode`. But MATRIXblock's setup block actually
carries **two** substacks -- `SUBSTACK` (init) and `SUBSTACK2` (main
loop body) -- and by convention every user program lives inside the
setup block's SUBSTACK2, not as a loose top-level block. Result: our
generator emitted `HALT` (1 byte) for any real workspace because the
top-level `mini_setup` produced `''` for the loop portion.

Fix in `generator_bytecode/control.js`: return `statementToCode('SUBSTACK2')`
as the emitted code. Confirmed on hardware: a workspace with just
`mini_setup > mini_setRGB` now compiles to 14 bytes and runs on the R4.

### 5. `control_wait` unit mismatch

The BytecodeVM handler multiplied `TIMES` by 1000 assuming seconds,
but MATRIXblock's `control_wait` field is milliseconds (matches the
Arduino generator's `delay(TIMES)`). A 1000 ms block was becoming
1000000 ms = 16 min wait. Fixed by removing the multiplication.

### 6. LED port field is `"1"`/`"2"`, not `"RGB1"`/`"RGB2"`

The BLOCK_OPCODE_MAP assumption came from the profile picker, but
`mini_setRGB` actually stores the numeric string. `lookupId()` now
falls back to `parseInt` for numeric strings so RGB1/RGB2/1/2 all
map to the right VM id. Without this the VM's `setColor` rejected
`id=0` silently and the LED stayed the previous colour.

### 7. IDE Connect flow ("GATT Server is disconnected" race)

Chromium's Web Bluetooth on Windows sometimes resolves
`gatt.connect()` before the ATT link is stable, and the immediately
following `getPrimaryService()` throws. Added:
- Retry loop with backoff (up to 4 attempts, ~2s total)
- Preserve `state.device` during retries; clear it only on a real
  post-connect disconnect
- On the R4 side, `BLE.setConnectionInterval(0x18, 0x30)` (30..60 ms)
  and `BLE.setSupervisionTimeout(0x00C8)` (2 s) so the peer stays
  within Chromium's tolerance window

### 8. Blocking user loop starves BLE stack

When a workspace has `control_forever` (or any wrapping loop) the
Arduino generator emits `void loop() { while(true) { ... } }`. Our
wrapper was inlining that inside `userLoop()` and calling `userLoop()`
from the driver's `loop()` -- but the `while(true)` never returned, so
`BLERuntime.poll()` fired exactly once and BLE went silent forever.

Fix in `arduino_ble_wrapper.js`: `stripOuterWhileTrue()` detects a
single outer `while (true|1) { ... }` that spans the whole loop body
and unwraps it. Arduino's own `loop()` is already auto-repeating so
this is safe. Nested `while(true)` inside conditionals is untouched
(that would be a real user choice, and today it will still starve
BLE -- see the next-session note below).

### 9. `state.uploading` never released for forever-loop programs

The IDE's "Enviar via BLE" waited for a HALT event before releasing
its `uploading` mutex. Programs that never HALT (control_forever)
locked out the button for 60 s. Fixed by releasing the mutex right
after `session.run()` succeeds; HALT events still surface as toasts
via a background listener but no longer gate future sends.

## Verified end-to-end on 2026-07-18

Hardware in the loop: MATRIX Mini R4 (arduino:renesas_uno:unor4wifi,
modem firmware 0.6.0), Windows 11 MATRIXblock IDE, Motorola phone
with nRF Connect.

- ✅ Simple 1-block workspace flashed via cable through the patched
  IDE. R4 boots, `MATRIX-R4-Runtime` shows up in nRF Connect.
- ✅ Connect via IDE, workspace with `mini_setRGB` (LED1 red), Enviar
  via BLE. R4 turns LED red within ~400 ms of clicking.
- ✅ Second Enviar (LED blue) reuses the same session, upload sizes
  ~14 bytes each, ~40 B/s effective.
- ✅ Third Enviar with `wait` block correctly delays in milliseconds.
- ⚠️ Workspaces with more than one block or with `control_forever`
  work over BLE, but if the user then does a USB cable upload of a
  similar multi-block workspace the R4 sometimes stops advertising
  BLE, and reconnecting fails intermittently until the next reflash.
  See "Bugs still open" below.

## Bugs still open at the end of the session

### A. Post-USB-upload BLE flakiness on multi-block workspaces

Confirmed by the user: with a single-block workspace the USB->BLE->USB
cycle is stable. With multi-block workspaces (multiple LED/wait
blocks, control_forever bodies, etc.) the R4 sometimes advertises
after cable upload and sometimes doesn't; when it does advertise the
first BLE Connect often fails and needs a retry. Native BLE-only
workflow is fine. The whole failure mode is triggered by USB uploads
of larger sketches.

Working hypothesis: even after `stripOuterWhileTrue()`, a busy
`userLoop()` with several sequential `delay()` calls can still starve
`BLE.poll()`. During the first BLE connect the peer expects an
interval-sized poll cadence; if the R4 hangs in `delay()` for 300+ ms
the peer drops us. The fix is probably to route all `delay()` calls
in wrapped user code through a `BLERuntime`-aware delay that keeps
polling BLE. Alternative: hardware timer that fires `BLE.poll()` in
the background regardless of what user code is doing.

Next session: pick between the two above and prototype.

### B. Nested / non-outer `while(true)` still starves BLE

`stripOuterWhileTrue()` only removes a while that spans the entire
loop body. A student who nests forever loops (inside a condition,
inside a helper function) will still starve BLE without warning.
Same solution as A -- a BLE-aware `delay()` or a timer-driven poll.

### C. IDE Connect UI has no picker, no cancel

Right now the "Conectar" button auto-selects the first advertised
`MATRIX-R4-Runtime`. If two hubs are in range there is no way to
choose. If the R4 is off or out of range the click hangs on
Chromium's default 15 s scan timeout with no way for the user to
abort. We need:

1. Each hub advertises a **unique** local name (e.g. suffix with the
   last 4 hex of the BLE MAC) so a picker is meaningful.
2. A modal listing all devices matching the `MATRIX-R4-` prefix, with
   a "Parar busca" button to cancel the requestDevice promise.
3. Optional: remember the last-picked device per browser origin.

Next session: firmware side first (rename local name), then IDE side.

## Recap of test totals

- `test/test_assembler.js`         12/12
- `test/test_handlers.js`           7/7 (updated for ms-vs-seconds)
- `test/test_wrapper.js`           12/12 (added while(true) strip tests)
- `test/test_hardware_handlers.js` 25/25 (new -- LED/motor/servo/IMU/OLED/pins)
- `e2e/test_ide.js`                29/29 (unchanged)
- Grand total: **85 asserts, all green**.

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
