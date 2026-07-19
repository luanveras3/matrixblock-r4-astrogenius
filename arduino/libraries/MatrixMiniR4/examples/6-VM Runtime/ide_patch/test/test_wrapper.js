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

if (/void setup\(\)\s*\n\{\s*\n\s*userSetup\(\);\s*\n\s*BLERuntime\.setSketchId\(MINIR4_SKETCH_ID\);\s*\n\s*BLERuntime\.begin\(\);/.test(wrapped))
    ok('driver setup calls userSetup + setSketchId + BLERuntime.begin');
else no('driver setup malformed');

if (/void loop\(\)\s*\n\{\s*\n\s*BLERuntime\.poll\(\);\s*\n\s*if \(!BLERuntime\.isRunningVM\(\)\)\s*\{\s*userLoop\(\); \}/.test(wrapped))
    ok('driver loop calls poll + guards userLoop');
else no('driver loop malformed');

// ---- 3. User's original code lives inside userSetup/userLoop -------------
// delay() gets rewritten to BLERuntime.delay() (see test group 7); everything
// else must survive verbatim.
if (wrapped.indexOf('MiniR4.begin(3);') >= 0
    && wrapped.indexOf('MiniR4.LED.setColor(1, 255, 0, 0);') >= 0
    && wrapped.indexOf('BLERuntime.delay(500);') >= 0)
    ok('user body preserved (delay rewritten)');
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

// ---- 6. Strip outer while(true) so BLE.poll() doesn't starve -------------
A.__originalFinish = () => '' +
    '#include "MatrixMiniR4.h"\n\n' +
    'void setup()\n{\n  MiniR4.begin();\n}\n\n' +
    'void loop()\n{\n' +
    '  while(true)\n  {\n' +
    '    MiniR4.LED.setColor(1, 255, 0, 0);\n    delay(1000);\n' +
    '  }\n' +
    '}\n';
const stripped = A.finish('');
if (stripped.indexOf('while(true)') < 0 && stripped.indexOf('while (true)') < 0
    && stripped.indexOf('while (1)') < 0)
    ok('outer while(true) removed from userLoop');
else no('outer while(true) NOT stripped -- will starve BLE');

if (stripped.indexOf('MiniR4.LED.setColor(1, 255, 0, 0);') >= 0
    && stripped.indexOf('delay(1000);') >= 0)
    ok('loop body preserved after stripping while(true)');
else no('loop body lost during strip');

// Nested while(true) inside a control_if MUST NOT be stripped (that's a
// user choice; we only touch a while that spans the entire loop body).
A.__originalFinish = () => '' +
    '#include "MatrixMiniR4.h"\n\n' +
    'void setup()\n{\n  MiniR4.begin();\n}\n\n' +
    'void loop()\n{\n' +
    '  if (something) {\n    while (true) { foo(); }\n  }\n' +
    '  bar();\n' +
    '}\n';
const nested = A.finish('');
if (nested.indexOf('while (true) { foo(); }') >= 0)
    ok('non-outer while(true) preserved');
else no('should not have touched inner while(true)');

// ---- 7. delay() -> BLERuntime.delay() rewrite ----------------------------
// The unit under test is __rewriteDelays. This isolates the substitution
// from the rest of the wrap so a regression here doesn't hide behind the
// other checks.
const rw = A.__rewriteDelays;

if (rw('delay(500);') === 'BLERuntime.delay(500);')
    ok('rewrites bare delay call');
else no('bare delay not rewritten: ' + rw('delay(500);'));

if (rw('  delay ( 250 );\n') === '  BLERuntime.delay ( 250 );\n')
    ok('rewrites delay with whitespace inside call');
else no('whitespace delay not rewritten: ' + rw('  delay ( 250 );\n'));

// Multiple calls on one line, both should flip.
if (rw('delay(1); do(); delay(2);') === 'BLERuntime.delay(1); do(); BLERuntime.delay(2);')
    ok('rewrites every delay in a line');
else no('multi-delay not rewritten: ' + rw('delay(1); do(); delay(2);'));

// False positives that must NOT flip:
const untouched = [
    'myDelay(500);',                          // identifier ending in delay
    'noDelay(1);',                            // ditto
    'foo.delay(1);',                          // method access on a member
    'Delay(1);',                              // capital D (some libs)
    'DELAY(1);',                              // ALL CAPS
    'delayMicroseconds(500);',                // Arduino sibling function
    'blockDelay = 500;',                      // variable name containing "delay"
];
for (const s of untouched) {
    if (rw(s) === s) ok('does not touch: ' + s);
    else no('wrongly rewrote "' + s + '" -> "' + rw(s) + '"');
}

// Line-start delay should still get rewritten.
if (rw('delay(10);') === 'BLERuntime.delay(10);')
    ok('rewrites delay at start of input');
else no('start-of-input delay skipped: ' + rw('delay(10);'));

// Idempotent: applying twice shouldn't produce BLERuntime.BLERuntime.delay.
const once = rw('delay(500);\n');
const twiceRw = rw(once);
if (twiceRw === 'BLERuntime.delay(500);\n')
    ok('rewrite is idempotent');
else no('rewrite not idempotent: ' + twiceRw);

// ---- 8. MINIR4_SKETCH_ID injection ---------------------------------------
// Wrapper must emit a #define for a fresh 32-bit ID per build so the runtime
// can detect USB reflashes and wipe stale BLE bytecode. Regenerate a small
// simple sketch to test in isolation.
A.__originalFinish = () => '' +
    '#include "MatrixMiniR4.h"\n\n' +
    'void setup()\n{\n  MiniR4.begin();\n}\n\n' +
    'void loop()\n{\n  MiniR4.LED.setColor(1, 0, 60, 0);\n}\n';
const idOut = A.finish('');

// Format: `#define MINIR4_SKETCH_ID ((uint32_t)0xXXXXXXXXu)` on its own line.
const idDefineRe = /#define\s+MINIR4_SKETCH_ID\s+\(\(uint32_t\)0x([0-9A-F]{8})u\)/;
const idMatch = idOut.match(idDefineRe);
if (idMatch) ok('sketch ID #define emitted');
else no('sketch ID #define missing or malformed');

// The #define must sit AFTER the runtime include and BEFORE the driver
// setup() that references it -- otherwise the sketch won't compile.
const includeIdx = idOut.indexOf('#include "Modules/MiniR4BLERuntime.h"');
const defineIdx  = idOut.search(idDefineRe);
const setSketchIdx = idOut.indexOf('BLERuntime.setSketchId(MINIR4_SKETCH_ID);');
if (includeIdx >= 0 && defineIdx > includeIdx && setSketchIdx > defineIdx)
    ok('sketch ID ordering: include < define < setSketchId call');
else no('sketch ID out of order: include=' + includeIdx +
        ' define=' + defineIdx + ' setSketchId=' + setSketchIdx);

// The ID must not be 0 or 0xFFFFFFFF (reserved as "unset" sentinel).
if (idMatch) {
    const value = parseInt(idMatch[1], 16);
    if (value !== 0 && value !== 0xFFFFFFFF)
        ok('sketch ID avoids reserved sentinels');
    else no('sketch ID hit reserved value: 0x' + idMatch[1]);
}

// Two back-to-back builds must produce different IDs (per-build randomness).
A.__originalFinish = () => '' +
    '#include "MatrixMiniR4.h"\n\nvoid setup(){}\nvoid loop(){}\n';
const outA = A.finish('');
const outB = A.finish('');
const idA = (outA.match(idDefineRe) || [])[1];
const idB = (outB.match(idDefineRe) || [])[1];
if (idA && idB && idA !== idB) ok('successive builds get different IDs');
else no('IDs collided: ' + idA + ' vs ' + idB);

// Direct check on the helper functions.
const gen = A.__generateSketchId;
const fmt = A.__formatSketchIdLit;
if (typeof gen() === 'number' && gen() !== gen())
    ok('generateSketchId returns changing numbers');
else no('generateSketchId not producing fresh numbers');
if (fmt(0x12345678) === '0x12345678u') ok('formatSketchIdLit basic case');
else no('formatSketchIdLit basic case: ' + fmt(0x12345678));
if (fmt(0x0000000A) === '0x0000000Au') ok('formatSketchIdLit pads to 8 hex');
else no('formatSketchIdLit padding: ' + fmt(0x0000000A));

console.log(fail ? '\n' + fail + ' FAILED' : '\n' + pass + '/' + pass + ' passed');
process.exitCode = fail ? 1 : 0;
