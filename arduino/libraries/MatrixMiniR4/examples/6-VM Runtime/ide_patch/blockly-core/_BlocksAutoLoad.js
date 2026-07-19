const blocks_dir = "../blockly-core/blocks/";
const blocks_picker_dir = "../blockly-core/blocks/picker/";
const generator_dir = "../blockly-core/generator/";
const generator_bytecode_dir = "../blockly-core/generator_bytecode/";

const Files = [
  "_mini",
  "control",
  "data",
  "math",
  "operators",
  "pins",
  "procedures",
  "text"
];

const Picker = [
  "colour",
  "matrix",
];

// Categories with a bytecode-emitting handler set. Missing entries are OK —
// the runtime warns per-block via Blockly.BytecodeVM.warn when compiling.
const BytecodeFiles = [
  "control",
  "data",
  "math",
  "operators",
  "_mini",
  "pins",
  "drivedc",
];

//Loading Blocks
document.write('<!-- Blocks JS -->');
for (let i = 0, file; (file = Files[i]); i++) {
  path = blocks_dir + file + '.js';
  document.write(`<script type="text/javascript" src="${path}"></script>`);
}

//Loading Blocks (color, matrix picker)
for (let i = 0, file; (file = Picker[i]); i++) {
  path = blocks_picker_dir + file + '.js';
  document.write(`<script type="text/javascript" src="${path}"></script>`);
}

//Loading Generators (Arduino, C++ output — existing USB compile path)
document.write('<!-- Generators JS -->');
for (let i = 0, file; (file = Files[i]); i++) {
  path = generator_dir + file + '.js';
  document.write(`<script type="text/javascript" src="${path}"></script>`);
}

// Loading Arduino BLE runtime wrapper -- post-processes Blockly.Arduino.finish
// so every USB-compiled sketch keeps BLE alive.
document.write('<!-- Arduino BLE Runtime Wrapper -->');
document.write(`<script type="text/javascript" src="../blockly-core/arduino_ble_wrapper.js"></script>`);

// Loading BytecodeVM generator (BLE runtime path — added for the R4 fork).
// Loads bytecode.js first (generator instance + assembler), then each
// category's handlers. See examples/6-VM Runtime/ide_patch/README.md.
document.write('<!-- BLE Runtime Bytecode Generator -->');
document.write(`<script type="text/javascript" src="../blockly-core/bytecode.js"></script>`);
for (let i = 0, file; (file = BytecodeFiles[i]); i++) {
  path = generator_bytecode_dir + file + '.js';
  document.write(`<script type="text/javascript" src="${path}"></script>`);
}
