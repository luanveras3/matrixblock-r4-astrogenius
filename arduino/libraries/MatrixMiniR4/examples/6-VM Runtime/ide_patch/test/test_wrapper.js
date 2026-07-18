'use strict';
/*
 * Standalone test for arduino_ble_wrapper.js. Loads the wrapper against a
 * stubbed Blockly.Arduino with a canned finish() output that matches what
 * blockly-core/arduino.js actually produces, then verifies the wrapped
 * result has the right shape.
 *
 * Usage:  node test_wrapper.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {
    goog: { provide: () => {}, require: () => {} },
    console,
};
sandbox.Blockly = {};
sandbox.Blockly.Arduino = {
    finish: function (code) {
        // Mimic the shape produced by arduino.js: imports + defs + setup + loop.
        return '' +
            '#include "MatrixMiniR4.h"\n' +
            '\n' +
            'float x;\n' +
            '\n' +
            'void setup()\n' +
            '{\n' +
            '  MiniR4.begin(3);\n' +
            '  MiniR4.LED.setBrightness(1, 60);\n' +
            '}\n' +
            '\n' +
            'void loop()\n' +
            '{\n' +
            '  MiniR4.LED.setColor(1, 255, 0, 0);\n' +
            '  delay(500);\n' +
            '  MiniR4.LED.setColor(1, 0, 0, 255);\n' +
            '  delay(500);\n' +
            '}\n';
    },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(
    path.join(__dirname, '..', 'blockly-core', 'arduino_ble_wrapper.js'),
    'utf8'), sandbox);

const A = sandbox.Blockly.Arduino;

let pass = 0, fail = 0;
function ok(m)   { console.log('ok    ' + m); pass++; }
function no(m)   { console.error('FAIL  ' + m); fail++; }

// ---- 1. finish() was replaced --------------------------------------------
if (typeof A.__originalFinish === 'function') ok('__originalFinish saved');
else no('original finish not saved');

// ---- 2. Wrapped output shape ---------------------------------------------
const wrapped = A.finish('');
if (wrapped.indexOf('#include "Modules/MiniR4BLERuntime.h"') >= 0)
    ok('runtime include added');
else no('runtime include missing');

if (wrapped.indexOf('static void userSetup()') >= 0) ok('userSetup emitted');
else no('userSetup missing');

if (wrapped.indexOf('static void userLoop()') >= 0) ok('userLoop emitted');
else no('userLoop missing');

if (/void setup\(\)\s*\n\{\s*\n\s*userSetup\(\);\s*\n\s*BLERuntime\.begin\(\);/.test(wrapped))
    ok('driver setup calls userSetup + BLERuntime.begin');
else no('driver setup malformed');

if (/void loop\(\)\s*\n\{\s*\n\s*BLERuntime\.poll\(\);\s*\n\s*if \(!BLERuntime\.isRunningVM\(\)\)\s*\{\s*userLoop\(\); \}/.test(wrapped))
    ok('driver loop calls poll + guards userLoop');
else no('driver loop malformed');

// ---- 3. User's original code lives inside userSetup/userLoop -------------
if (wrapped.indexOf('MiniR4.begin(3);') >= 0
    && wrapped.indexOf('MiniR4.LED.setColor(1, 255, 0, 0);') >= 0
    && wrapped.indexOf('delay(500);') >= 0)
    ok('user body preserved verbatim');
else no('user body altered');

// ---- 4. Idempotency ------------------------------------------------------
// Calling finish() again on a workspace should produce a wrap ONCE, not twice.
// Simulate by making original.finish return the already-wrapped output.
A.__originalFinish = () => wrapped;
const twice = A.finish('');
const marks = twice.split('static void userSetup()').length - 1;
if (marks === 1) ok('idempotent: userSetup appears exactly once on re-wrap');
else no('idempotent broken: ' + marks + ' userSetup markers');

// ---- 5. Pass-through when generator format changes -----------------------
A.__originalFinish = () => 'garbage without setup or loop\n';
const pass1 = A.finish('');
if (pass1 === 'garbage without setup or loop\n')
    ok('gracefully passes through when setup/loop not found');
else no('should have returned unchanged: ' + pass1);

console.log(fail ? '\n' + fail + ' FAILED' : '\n' + pass + '/' + pass + ' passed');
process.exitCode = fail ? 1 : 0;
