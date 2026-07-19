'use strict';
/*
 * Integration test for the hardware/pins bytecode handlers.
 *
 * Runs under Node with no dependencies. Mirrors test_handlers.js but
 * covers the LED / buzzer / motor / servo / IMU / button / OLED / GPIO
 * blocks added in generator_bytecode/_mini.js and pins.js.
 *
 * Usage:  node test_hardware_handlers.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---- Load bytecode.js + handlers into a shared sandbox -------------------
const sandbox = { goog: { provide: () => {}, require: () => {} }, console };
sandbox.Blockly = { Generator: function () {} };
Object.assign(sandbox.Blockly.Generator.prototype, {
    blockToCode: () => '',
    statementToCode: () => '',
    valueToCode: () => '',
    workspaceToCode: () => '',
});
vm.createContext(sandbox);

function load(rel) {
    vm.runInContext(fs.readFileSync(
        path.join(__dirname, '..', 'blockly-core', rel), 'utf8'), sandbox);
}
load('bytecode.js');
load('generator_bytecode/control.js');
load('generator_bytecode/data.js');
load('generator_bytecode/math.js');
load('generator_bytecode/operators.js');
load('generator_bytecode/_mini.js');
load('generator_bytecode/pins.js');

const G = sandbox.Blockly.BytecodeVM;

// ---- Mock block factories ------------------------------------------------
function mkBlock(type, fields, values) {
    fields = fields || {};
    values = values || {};
    return {
        type,
        _fields: fields,
        _values: values,
        getFieldValue(name) { return this._fields[name]; },
        getField(name) { return name in this._fields ? { name } : null; },
        nextConnection: null,
    };
}
function mkNum(n) { return mkBlock('math_number', { NUM: String(n) }); }

G.valueToCode = function (block, name) {
    const child = block._values[name];
    if (!child) return '';
    const handler = G[child.type];
    if (!handler) throw new Error('no handler for ' + child.type);
    const result = handler.call(child, child);
    return Array.isArray(result) ? result[0] : (result || '');
};
G.statementToCode = () => '';

function assemble(tokens) { return Array.from(G._assemble(tokens)); }
function bytesToHex(arr) {
    return arr.map(b => b.toString(16).padStart(2, '0')).join(' ');
}
function assertEq(actual, expected, label) {
    const a = bytesToHex(actual);
    const e = bytesToHex(expected);
    if (a !== e) {
        console.error(`FAIL ${label}:\n  expected: ${e}\n  actual:   ${a}`);
        process.exitCode = 1;
    } else {
        console.log(`ok    ${label}`);
    }
}

const OP = G.OPS;

// ---- LED ------------------------------------------------------------------
G.init({});
{
    const b = mkBlock('mini_setRGB', { PIN: 'RGB1' }, {
        R: mkNum(255), G: mkNum(0), B: mkNum(128),
    });
    const tok = G['mini_setRGB'].call(b, b);
    // push id=1, r=255, g=0, b=128, LED_COLOR
    assertEq(assemble(tok),
        [OP.PUSH_I8, 1,
         OP.PUSH_I16, 0xFF, 0x00,   // 255 falls into I16 range since signed
         OP.PUSH_I8, 0,
         OP.PUSH_I16, 0x80, 0x00,
         OP.LED_COLOR],
        'mini_setRGB LED1 (255,0,128) -> LED_COLOR');
}

G.init({});
{
    const b = mkBlock('mini_setRGB_Brightness', { PIN: 'RGB2' }, {
        Brightness: mkNum(50),
    });
    const tok = G['mini_setRGB_Brightness'].call(b, b);
    assertEq(assemble(tok),
        [OP.PUSH_I8, 2, OP.PUSH_I8, 50, OP.LED_BRIGHT],
        'mini_setRGB_Brightness LED2, 50 -> LED_BRIGHT');
}

// ---- Buzzer ---------------------------------------------------------------
G.init({});
{
    const b = mkBlock('mini_Buzzer_Tone', {}, {
        FREQ: mkNum(262), VOL: mkNum(100),
    });
    const tok = G['mini_Buzzer_Tone'].call(b, b);
    // 262 in I16 little-endian: 0x06 0x01. 100 fits I8.
    assertEq(assemble(tok),
        [OP.PUSH_I16, 0x06, 0x01, OP.PUSH_I8, 100, OP.BUZZ_TONE],
        'mini_Buzzer_Tone 262Hz 100ms -> BUZZ_TONE');
}

G.init({});
{
    const tok = G['mini_Buzzer_NoTone'].call({}, {});
    assertEq(assemble(tok), [OP.BUZZ_STOP],
        'mini_Buzzer_NoTone -> BUZZ_STOP');
}

// ---- Motor ---------------------------------------------------------------
G.init({});
{
    const b = mkBlock('mini_MsetPower', { PIN: 'M3' }, {
        Power: mkNum(75),
    });
    const tok = G['mini_MsetPower'].call(b, b);
    assertEq(assemble(tok),
        [OP.PUSH_I8, 3, OP.PUSH_I8, 75, OP.MOTOR_POWER],
        'mini_MsetPower M3 75 -> MOTOR_POWER');
}

G.init({});
{
    const b = mkBlock('mini_Mrot', { PIN: 'M1' }, {
        Speed: mkNum(50), Degree: mkNum(360),
    });
    const tok = G['mini_Mrot'].call(b, b);
    // id=1, spd=50, degs=360 (I16), MOTOR_ROTATE
    assertEq(assemble(tok),
        [OP.PUSH_I8, 1,
         OP.PUSH_I8, 50,
         OP.PUSH_I16, 0x68, 0x01,
         OP.MOTOR_ROTATE],
        'mini_Mrot M1 50 360 -> MOTOR_ROTATE');
}

G.init({});
{
    const b = mkBlock('mini_Mbrake', { PIN: 'M2', BrakeType: 'true' });
    const tok = G['mini_Mbrake'].call(b, b);
    assertEq(assemble(tok),
        [OP.PUSH_I8, 2, OP.PUSH_I8, 1, OP.MOTOR_BRAKE],
        'mini_Mbrake M2 true -> MOTOR_BRAKE');
}

G.init({});
{
    const b = mkBlock('mini_ENC_reset', { PIN: 'M4' });
    const tok = G['mini_ENC_reset'].call(b, b);
    assertEq(assemble(tok),
        [OP.PUSH_I8, 4, OP.MOTOR_RESET],
        'mini_ENC_reset M4 -> MOTOR_RESET');
}

G.init({});
{
    const b = mkBlock('mini_ENC_get', { PIN: 'M1' });
    const [tok] = G['mini_ENC_get'].call(b, b);
    assertEq(assemble(tok),
        [OP.PUSH_I8, 1, OP.MOTOR_DEGREES],
        'mini_ENC_get M1 -> MOTOR_DEGREES (value block)');
}

// ---- Servo ---------------------------------------------------------------
G.init({});
{
    const b = mkBlock('mini_RCset', { PIN: 'RC2' }, {
        Angle: mkNum(90),
    });
    const tok = G['mini_RCset'].call(b, b);
    assertEq(assemble(tok),
        [OP.PUSH_I8, 2, OP.PUSH_I8, 90, OP.SERVO_ANGLE],
        'mini_RCset RC2 90 -> SERVO_ANGLE');
}

// ---- Buttons -------------------------------------------------------------
G.init({});
{
    const b = mkBlock('mini_BTNget', { PIN: 'BTN_UP' });
    const [tok] = G['mini_BTNget'].call(b, b);
    assertEq(assemble(tok),
        [OP.PUSH_I8, 1, OP.BTN_PRESSED],
        'mini_BTNget BTN_UP -> BTN_PRESSED');
}

// ---- IMU -----------------------------------------------------------------
G.init({});
{
    const b = mkBlock('mini_motion_getEuler', { AXIS: 'Roll' });
    const [tok] = G['mini_motion_getEuler'].call(b, b);
    assertEq(assemble(tok),
        [OP.PUSH_I8, 0, OP.IMU_EULER],
        'mini_motion_getEuler Roll -> IMU_EULER axis 0');
}

G.init({});
{
    const b = mkBlock('mini_motion_getGyro', { AXIS: 'Z' });
    const [tok] = G['mini_motion_getGyro'].call(b, b);
    assertEq(assemble(tok),
        [OP.PUSH_I8, 2, OP.IMU_GYRO],
        'mini_motion_getGyro Z -> IMU_GYRO axis 2');
}

// _RAW suffix should be stripped with a warning
G.init({});
{
    const b = mkBlock('mini_motion_getAccel', { AXIS: 'X_RAW' });
    const [tok] = G['mini_motion_getAccel'].call(b, b);
    assertEq(assemble(tok),
        [OP.PUSH_I8, 0, OP.IMU_ACCEL],
        'mini_motion_getAccel X_RAW -> IMU_ACCEL axis 0 (RAW downgraded)');
    if (G._warnings.some(w => w.block === 'mini_motion_getAccel')) {
        console.log('ok    _RAW axis emits warning');
    } else {
        console.error('FAIL _RAW axis did not warn'); process.exitCode = 1;
    }
}

G.init({});
{
    const tok = G['mini_motion_reset'].call({}, {});
    assertEq(assemble(tok), [OP.IMU_RESET],
        'mini_motion_reset -> IMU_RESET');
}

// ---- OLED ----------------------------------------------------------------
G.init({});
{
    const tok = G['mini_OLED_clear'].call({}, {});
    assertEq(assemble(tok), [OP.OLED_CLEAR], 'mini_OLED_clear -> OLED_CLEAR');
}
G.init({});
{
    const b = mkBlock('mini_OLED_setCusor', {}, {
        X: mkNum(10), Y: mkNum(20),
    });
    const tok = G['mini_OLED_setCusor'].call(b, b);
    assertEq(assemble(tok),
        [OP.PUSH_I8, 10, OP.PUSH_I8, 20, OP.OLED_CURSOR],
        'mini_OLED_setCusor(10,20) -> OLED_CURSOR');
}
G.init({});
{
    const b = mkBlock('mini_OLED_print', {}, { STR: mkNum(42) });
    const tok = G['mini_OLED_print'].call(b, b);
    assertEq(assemble(tok),
        [OP.PUSH_I8, 42, OP.OLED_PRINT_I],
        'mini_OLED_print 42 -> OLED_PRINT_I');
}

// ---- Time / millis -------------------------------------------------------
G.init({});
{
    const [tok] = G['mini_millis'].call({}, {});
    assertEq(assemble(tok), [OP.MILLIS], 'mini_millis -> MILLIS');
}

// ---- PWR -----------------------------------------------------------------
G.init({});
{
    const [tok] = G['mini_PWR_getVolt'].call({}, {});
    assertEq(assemble(tok), [OP.PWR_VOLT], 'mini_PWR_getVolt -> PWR_VOLT');
}

// ---- pins_pin_mode (INPUT_PULLUP on pin 13) ------------------------------
G.init({});
{
    const modeBlk = mkBlock('pins_input_output', { MODE: 'INPUT_PULLUP' });
    const pinBlk  = mkBlock('pins_digital', { PIN: '13' });
    const b = mkBlock('pins_pin_mode', {}, { PIN: pinBlk, MODE: modeBlk });
    const tok = G['pins_pin_mode'].call(b, b);
    assertEq(assemble(tok),
        [OP.PUSH_I8, 13, OP.PUSH_I8, 2, OP.PIN_MODE],
        'pins_pin_mode(13, INPUT_PULLUP) -> PIN_MODE');
}

G.init({});
{
    const pinBlk = mkBlock('pins_digital', { PIN: '9' });
    const valBlk = mkBlock('pins_high_low', { HIGHLOW: 'HIGH' });
    const b = mkBlock('pins_digital_write', {}, { PIN: pinBlk, STATE: valBlk });
    const tok = G['pins_digital_write'].call(b, b);
    assertEq(assemble(tok),
        [OP.PUSH_I8, 9, OP.PUSH_I8, 1, OP.DIGITAL_WRITE],
        'pins_digital_write(9, HIGH) -> DIGITAL_WRITE');
}

G.init({});
{
    const pinBlk = mkBlock('pins_analog', { PIN: '14' });
    const b = mkBlock('pins_analog_read', {}, { PIN: pinBlk });
    const [tok] = G['pins_analog_read'].call(b, b);
    assertEq(assemble(tok),
        [OP.PUSH_I8, 14, OP.ANALOG_READ],
        'pins_analog_read(A0=pin 14) -> ANALOG_READ');
}

// ---- Unknown port warns and defaults to 0 --------------------------------
G.init({});
{
    const b = mkBlock('mini_MsetPower', { PIN: 'BOGUS' }, {
        Power: mkNum(1),
    });
    G['mini_MsetPower'].call(b, b);
    if (G._warnings.some(w => w.block === 'mini_MsetPower')) {
        console.log('ok    unknown motor port emits warning');
    } else {
        console.error('FAIL unknown port did not warn'); process.exitCode = 1;
    }
}

console.log(process.exitCode ? '\nFAILED' : '\nAll hardware handler tests passed.');
