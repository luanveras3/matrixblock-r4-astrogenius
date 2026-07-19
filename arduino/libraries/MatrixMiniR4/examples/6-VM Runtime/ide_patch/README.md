# MATRIXblock BLE runtime — IDE patch

This directory adds a **Send via BLE** button to the MATRIXblock Mini R4 IDE.
It is additive: the existing USB compile+upload flow is left completely
untouched. The new button runs a separate Blockly generator that emits
`MiniR4VM` bytecode, then streams it to the R4 over Web Bluetooth using the
`MATRIX-R4-Runtime` NUS protocol from `../MiniR4_BLE_Runtime/`.

## Layout

    ide_patch/
    ├── blockly-core/
    │   ├── bytecode.js                # Blockly.BytecodeVM (generator + assembler)
    │   ├── ble_upload.js              # toolbar button + Web Bluetooth uploader
    │   ├── _BlocksAutoLoad.js         # extended loader (adds bytecode generators)
    │   └── generator_bytecode/
    │       ├── control.js
    │       ├── data.js
    │       ├── math.js
    │       └── operators.js
    ├── test/
    │   ├── test_assembler.js          # `node test_assembler.js`
    │   └── test_handlers.js           # `node test_handlers.js`
    ├── build.ps1                      # repacks app.asar with the patch applied
    └── README.md

## Build & install

Close the MATRIXblock IDE first (Windows keeps `resources/app.asar` locked
while the app is running).

    powershell -File .\build.ps1

The script:
1. Installs `@electron/asar` in `%TEMP%\asar-tmp` if missing.
2. Extracts `C:\matrixblock-r4\resources\app.asar` to a scratch tree.
3. Copies our new files into `blockly-core/`.
4. Idempotently injects one `<script src="../blockly-core/ble_upload.js">`
   tag into `views/main.html` (bracketed by a marker so re-runs are safe).
5. Backs up the current asar to `app.asar.pre-ble.bak` (first run only) and
   repacks the tree into `app.asar`.

To revert, restore from `app.asar.pre-ble.bak` (or the older
`app.asar.original.bak` snapshot).

## What the button does

1. Runs `Blockly.BytecodeVM.compile(workspace)` → `{ bytes, warnings, variables }`.
2. Opens `navigator.bluetooth` and asks the user to pick `MATRIX-R4-Runtime`.
3. Runs the START/CHUNK/END/RUN protocol from
   `../python_client/miniR4_client.py`.
4. Prints progress and any VM error into the `.console-Div` panel.

## Block coverage in this drop

**Emitted directly** (~35 blocks):
- Control: `control_setup`, `mini_setup`, `control_wait`, `control_if`,
  `control_if_else`, `control_forever`, `control_repeat`, `control_wait_until`,
  `control_repeat_until`.
- Data: `data_variable`, `data_setvariableto`, `data_changevariableby`
  (16 variable slots).
- Math literals: `math_number`, `math_integer`, `math_whole_number`,
  `math_angle` (int-only; float truncation warns the user).
- Operators: `+ - * / % random < > == && || !`, `round`, `constrain`,
  `const_bool`.
- Procedures (Scratch-style, void only): `procedures_definition`,
  `procedures_call`, `argument_reporter_string_number`,
  `argument_reporter_boolean`. String args (`argument_reporter_string_only`)
  warn and evaluate as 0 — the VM is int32-only. Recursion is not supported
  (arg slots are static per procedure); a self-call will overwrite the
  caller's args.

**Not yet emitted** — `operator_mathop` (sqrt/sin/...), all string operators,
and every hardware block (GPIO, DriveDC, LED, motors, sensors...). These
will be added in the next slice — see `../BLOCK_OPCODE_MAP.md`.
Unsupported blocks call `Blockly.BytecodeVM.warn()` so the compile still
succeeds; the console lists what was skipped.

## Testing

Both smoke tests run under Node with stubs (no browser needed):

    node test/test_assembler.js       # 12 assembler primitives
    node test/test_handlers.js        # 7 handler integration cases
