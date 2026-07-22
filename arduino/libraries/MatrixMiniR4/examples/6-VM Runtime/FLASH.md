# Flashing the always-on BLE runtime to the R4

TL;DR — one command from this folder:

```powershell
cd "arduino\libraries\MatrixMiniR4\examples\6-VM Runtime"
.\flash.ps1
```

Auto-detects the R4 WiFi port, compiles `MiniR4_BLE_Runtime.ino`, and uploads.
Expected result: `Sketch uses 134332 bytes (51%) of program storage space` and
the R4 starts advertising `MATRIX-R4-Runtime` over BLE.

## Why there are two `arduino/` trees

Flashing the runtime requires a full Arduino toolchain **plus** the complete
`MatrixMiniR4`, `ArduinoBLE`, `PubSubClient`, `HUSKYLENS` libraries. This repo
only carries the delta on top of upstream `MatrixMiniR4` (the
`src/Modules/MiniR4BLERuntime.{h,cpp}` files and the runtime sketch), so it is
**not buildable on its own**.

The full self-contained build environment lives at:

    C:\matrixblock-r4\arduino\
    ├── arduino-cli.exe              # bundled CLI (matches the MATRIXblock IDE version)
    ├── arduino-cli.yaml             # points data/user dirs at ./ so libraries below win
    ├── libraries\
    │   ├── ArduinoBLE\
    │   ├── HUSKYLENS\
    │   ├── MatrixMiniR4\            # full 1.2.2 library + our BLE runtime delta
    │   └── PubSubClient\
    └── packages\arduino\hardware\renesas_uno\1.5.1\   # the Renesas core

`flash.ps1` targets that tree directly. It does **not** use the user's
`~\Documents\Arduino\libraries\` or `~\OneDrive\Documentos\Arduino\libraries\`
sketchbook. If you edit `MiniR4BLERuntime.{h,cpp}` or the runtime `.ino` in
this git checkout, sync your changes to the toolchain tree first:

```powershell
.\flash.ps1 -Sync           # copy runtime + sketch from repo -> toolchain, then build + upload
.\flash.ps1 -Sync -CompileOnly   # sync + build only, no upload
```

## Common flags

| flag              | what it does                                                            |
|-------------------|-------------------------------------------------------------------------|
| `-CompileOnly`    | Dry run — compile, skip upload. Use to verify a change.                 |
| `-Port COM10`     | Force a specific port instead of auto-detecting.                        |
| `-Sync`           | Copy runtime + sketch from this git checkout into the toolchain tree.   |
| `-ToolchainRoot`  | Override `C:\matrixblock-r4\arduino` if you keep it elsewhere.          |
| `-Fqbn`           | Override the board FQBN (default `arduino:renesas_uno:unor4wifi`).      |

## Verifying the flash worked

1. A hub named `MATRIX-*` shows up in **nRF Connect** on your phone within
   ~1 second of reset. A brand-new R4 advertises `MATRIX-R4-Runtime`; any
   name saved through the IDE modal (see below) shows up instead.
   The Windows Bluetooth settings panel will NOT show this device — see
   `project_ble_scanner_gotcha` in memory.
2. **LED2** goes dim green when the stack is up and no client is connected,
   cyan when a central connects. If LED2 stays off after reset, either the
   kill-switch flag is disabled (hold BTN_UP + BTN_DOWN 3 s to toggle) or
   the ArduinoBLE stack failed to come up.
3. **LED1** is untouched by the runtime — user code / VM opcodes own it.
4. Open the MATRIXblock IDE, click **Conectar** to open the modal, hit
   **Buscar**, then **Enviar via BLE** on any workspace.
5. To go back to native mode, USB-reflash from the IDE (each build gets a
   fresh `MINIR4_SKETCH_ID` so the runtime wipes the stored bytecode on
   boot), or send `CMD_ERASE` (0x06) over BLE.

## Renaming a hub

The IDE modal has a "Renomear este hub" section that appears once you're
connected. Type any suffix; the IDE prepends `MATRIX-` automatically and
sends `CMD_SET_NAME` (0x08). The runtime persists the new name to
dataflash block 6 and rejects any payload that doesn't start with
`MATRIX-` (hard guarantee — a rogue nRF Connect write can't rename the
hub to something undiscoverable). Names are printable ASCII, max 24
characters. The change takes effect after the R4 restarts because
ArduinoBLE doesn't support flipping the advertised local name mid-run.

Discovery still works after a rename: leaving the modal's Hub Name field
at `MATRIX-` triggers a `namePrefix: "MATRIX-"` scan, which surfaces
every hub in range in Electron's native picker so a forgotten name is
recoverable.

## When it breaks

Almost every failure I've seen falls into one of these:

- **`fatal error: Modules/MiniR4BLERuntime.h: No such file`** — arduino-cli
  picked up a stale `MatrixMiniR4` from your Documents/OneDrive sketchbook
  instead of the toolchain copy. Check that the toolchain has the runtime
  files (`ls C:\matrixblock-r4\arduino\libraries\MatrixMiniR4\src\Modules\`)
  and that `flash.ps1` printed `arduino-cli: C:\matrixblock-r4\arduino\...`.
- **`No R4 WiFi detected`** — cable is data-only or the R4 is in bootloader
  mode. Double-tap the reset button to exit bootloader, or pass `-Port COMx`
  explicitly.
- **Upload hangs at 0%** — port is held open by another process (Arduino
  IDE Serial Monitor, a Python script). Close it and retry.
- **BLE stack up but nothing advertises** — RF power gate. Give the R4 a
  proper 5V USB supply, not a low-power hub. This was the 2026-07-18 debug
  rabbit hole; see `SESSION_2026-07-18_ALWAYS_ON_BLE.md`.

## Program size limits (BLE upload path)

The BLE runtime persists uploaded bytecode to dataflash blocks 1..6, which
caps a single upload at **6144 bytes**. `CMD_START` refuses anything
larger. Rough sizes per Blockly block:

| Pattern                          | Bytes    |
|----------------------------------|----------|
| `control_forever`                | ~3       |
| `if / else` branch               | ~6       |
| `LED cor R,G,B`                  | ~9       |
| `DriveDC on(30, 30)`             | ~7       |
| `set var = 5`                    | ~4       |
| `if sensor > 500`                | ~11      |
| `math_number` int8 / int32       | 2 / 5    |

Rule of thumb: **~10 bytes per block**. Practical ceiling:

- 200 blocks ≈ 2 KB — fits easily
- 600 blocks ≈ 6 KB — approaching the wall
- 1000 blocks ≈ 10 KB — refused at CMD_START

Competition programs hit this earlier because they duplicate mission
patterns. Both easy levers are now landed:

1. **`procedures_*` blocks (My Blocks)** — DONE (feat 457f3a3, 2026-07-19).
   Procedure blocks compile to `CALL`/`RET`; typical competition workspace
   shrinks 30-50 % because repeated mission code becomes one subroutine.
2. **Grew `MAX_PROGRAM` to 6 KB** — DONE. Fused enable-flag + sketch-ID +
   device-name into a single "MBRC" config record in block 7, freeing
   blocks 5+6 for bytecode. +50 % headroom (4 KB → 6 KB). Migration cost:
   hubs updated from an older firmware lose their custom BLE name and
   kill-switch state on first boot; kill switch reverts to enabled by
   default, and the hub re-advertises as `MATRIX-R4-Runtime` until
   renamed.

If a workspace still won't fit after both levers, the remaining paths are
bytecode compression in the IDE (constant pool, short jumps) or a
RAM-only "test mode" that skips persistence entirely.

## The wrapper vs this standalone sketch

Most flashes in normal use go through the MATRIXblock IDE, which wraps
whatever Blockly workspace the student made into an `.ino` that calls
`BLERuntime.begin()` and `BLERuntime.poll()` around the user code, then USB-
uploads it. This standalone sketch is only for:

- Bringing up a new R4 that has never had the runtime on it.
- Reproducing a runtime bug without the wrapper in the mix.
- Wiping user code so the R4 boots directly into BLE listener mode.
