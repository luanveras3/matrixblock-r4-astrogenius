/*
 * Tests for resources/app_src/blockly-core/arduino_wifi_wrapper.js.
 * Runs under plain Node with Blockly stubbed out.
 *
 * Run: node wifi_wrapper.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// --- Load the wrapper with a stubbed browser environment ---------------------

const sandbox = {
    console,
    Blockly: {
        Arduino: {
            finish: (code) => code,   // identity "original" finish
        },
    },
};
sandbox.window = sandbox;
vm.createContext(sandbox);

const src = fs.readFileSync(
    path.join(__dirname, '..', 'resources', 'app_src', 'blockly-core',
              'arduino_wifi_wrapper.js'),
    'utf8');
vm.runInContext(src, sandbox);

const A = sandbox.Blockly.Arduino;

let failures = 0;
function check(name, cond, detail) {
    if (cond) console.log(`ok   ${name}`);
    else { failures++; console.error(`FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

// --- 1. typical generator output ---------------------------------------------

const typical = [
    '#include <MatrixMiniR4.h>',
    '',
    'void setup() {',
    '  MiniR4.begin();',
    '  MiniR4.M1.setReverse(true);',
    '}',
    '',
    'void loop() {',
    '  while (true) {',
    '    MiniR4.M1.setPower(50);',
    '    delay(1000);',
    '    MiniR4.M1.setPower(0);',
    '    delay(1000);',
    '  }',
    '}',
    '',
].join('\n');

const wrapped = A.finish(typical);

check('include injected', wrapped.includes('#include "Modules/MiniR4WiFiRuntime.h"'));
check('userSetup emitted', wrapped.includes('static void userSetup()'));
check('userLoop emitted', wrapped.includes('static void userLoop()'));
check('MiniR4.begin() hoisted into driver',
    /void setup\(\)\n\{\n  MiniR4\.begin\(\);\n  WiFiRuntime\.setSketchId\(MINIR4_SKETCH_ID\);\n  WiFiRuntime\.begin\(\);\n  userSetup\(\);/.test(wrapped),
    wrapped.slice(wrapped.indexOf('void setup()')));
check('MiniR4.begin() removed from userSetup',
    !/userSetup\(\)\n\{[^}]*MiniR4\.begin\(\)/.test(wrapped));
check('outer while(true) stripped',
    !/userLoop\(\)\n\{\s*while\s*\(\s*true\s*\)/.test(wrapped));
check('delay rewritten to safeDelay', wrapped.includes('WiFiRuntime.safeDelay(1000)'));
check('no bare delay( left',
    !/[^.A-Za-z0-9_]delay\s*\(/.test(wrapped.replace(/safeDelay/g, 'SD')));
check('poll in driver loop',
    /void loop\(\)\n\{\n  WiFiRuntime\.poll\(\);\n  if \(!WiFiRuntime\.isRunningVM\(\)\) \{ userLoop\(\); \}/.test(wrapped));

// --- 1b. sketch id (VM persistence) ------------------------------------------
// The runtime compares this id against the one stored with a saved VM
// program; without it a reflash would silently keep auto-running stale
// bytecode. It must be a fresh value on every build.
check('sketch id defined once',
    (wrapped.match(/#define MINIR4_SKETCH_ID/g) || []).length === 1);
check('sketch id is a u32 literal',
    /#define MINIR4_SKETCH_ID \(\(uint32_t\)0x[0-9A-F]{8}u\)/.test(wrapped));
check('sketch id defined after the runtime include',
    wrapped.indexOf('#define MINIR4_SKETCH_ID') >
    wrapped.indexOf('#include "Modules/MiniR4WiFiRuntime.h"'));
check('sketch id set before begin()',
    wrapped.indexOf('WiFiRuntime.setSketchId') < wrapped.indexOf('WiFiRuntime.begin()'));
check('sketch id differs between builds', (function () {
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add(A.__generateSketchId());
    return ids.size > 45 && !ids.has(0) && !ids.has(0xFFFFFFFF);
})());

// --- 2. idempotence -----------------------------------------------------------

check('idempotent (second finish passes through)', A.finish(wrapped) === wrapped);

// --- 3. no MiniR4.begin() in setup — falls back to BLE-branch order ----------

const noBegin = [
    '#include <MatrixMiniR4.h>',
    'void setup() {',
    '  Serial.begin(9600);',
    '}',
    'void loop() {',
    '  delay(10);',
    '}',
].join('\n');
const wrappedNoBegin = A.finish(noBegin);
check('fallback order userSetup-then-begin',
    /void setup\(\)\n\{\n  userSetup\(\);\n  WiFiRuntime\.setSketchId\(MINIR4_SKETCH_ID\);\n  WiFiRuntime\.begin\(\);/.test(wrappedNoBegin));
check('Serial.begin untouched by the print rewrite',
    wrappedNoBegin.includes('Serial.begin(9600)'));

// --- 4. delay edge cases ------------------------------------------------------

const edge = A.__rewriteWifiDelays('myDelay(5); foo.delay(5); Delay(5); delay(5); x=delay(9);');
check('identifier myDelay untouched', edge.includes('myDelay(5)'));
check('member foo.delay untouched', edge.includes('foo.delay(5)'));
check('capital Delay untouched', edge.includes(' Delay(5)'));
check('bare delay rewritten', edge.includes(' WiFiRuntime.safeDelay(5)'));
check('assignment delay rewritten', edge.includes('x=WiFiRuntime.safeDelay(9)'));

// --- 4b. Serial print redirect (R3 v2) ---------------------------------------
// Print blocks must reach the wireless console without losing their USB
// behaviour, and nothing else on Serial may be touched.
const prints = A.__rewriteWifiPrints([
    'Serial.begin(9600);',
    'Serial.print("hello");',
    'Serial.println("world");',
    'Serial.println();',
    'Serial.print(x, HEX);',
    'Serial.write(65);',
    'Serial.available();',
    'mySerial.print("no");',
    'Serial.printSomething(1);',
].join('\n'));
check('print redirected',    prints.includes('WiFiRuntime.logPrint("hello")'));
check('println redirected',  prints.includes('WiFiRuntime.logPrintln("world")'));
check('bare println redirected', prints.includes('WiFiRuntime.logPrintln();'));
check('two-arg print redirected', prints.includes('WiFiRuntime.logPrint(x, HEX)'));
check('Serial.begin untouched',     prints.includes('Serial.begin(9600)'));
check('Serial.write untouched',     prints.includes('Serial.write(65)'));
check('Serial.available untouched', prints.includes('Serial.available()'));
check('other object .print untouched', prints.includes('mySerial.print("no")'));
check('printSomething untouched',   prints.includes('Serial.printSomething(1)'));
check('no bare Serial.print left',
    !/(^|[^A-Za-z0-9_.])Serial\.println?\s*\(/.test(prints));
check('print rewrite reaches the full sketch',
    A.finish([
        '#include <MatrixMiniR4.h>',
        'void setup() {',
        '  MiniR4.begin();',
        '  Serial.begin(9600);',
        '}',
        'void loop() {',
        '  Serial.println(MiniR4.PWR.getVoltage());',
        '}',
    ].join('\n')).includes('WiFiRuntime.logPrintln(MiniR4.PWR.getVoltage())'));

// --- 4c. blocking loops (the release-blocking bug) ---------------------------
// Students gate their programs with "wait until BTN_UP", which compiles to a
// bare busy-wait; without pumping the runtime from inside loops, the typical
// program takes the hub off the network from boot.
const L = A.__rewriteWifiLoops;

// Note: the rewrite preserves the user's original spacing around the
// keyword — the generated sketch stays as close to what the blocks emitted
// as possible, so anyone reading it can still recognise their own program.
// A bare busy-wait on any condition must be pumped. (The specific
// "wait until BTN_UP" shape is special-cased into waitForStart() — see 4d.)
check('bare busy-wait is pumped',
    L('while(!sensorReady);') === 'while(WiFiRuntime.tick(!sensorReady));',
    L('while(!sensorReady);'));
check('loop with a body is pumped',
    L('while (a < b) { x++; }') === 'while (WiFiRuntime.tick(a < b)) { x++; }',
    L('while (a < b) { x++; }'));
check('do-while is pumped',
    L('do { x++; } while (x < 3);') === 'do { x++; } while (WiFiRuntime.tick(x < 3));',
    L('do { x++; } while (x < 3);'));
check('for condition is pumped',
    L('for (int i = 0; i < 10; i++) { }') ===
    'for (int i = 0;WiFiRuntime.tick(i < 10); i++) { }',
    L('for (int i = 0; i < 10; i++) { }'));
check('empty for condition becomes a tick',
    L('for (;;) { }') === 'for (;WiFiRuntime.tick(); ) { }' ||
    L('for (;;) { }') === 'for (;WiFiRuntime.tick();) { }',
    L('for (;;) { }'));
check('nested parens in the condition survive',
    L('while (f(a, (b + c)) > 0) { }') ===
    'while (WiFiRuntime.tick(f(a, (b + c)) > 0)) { }',
    L('while (f(a, (b + c)) > 0) { }'));
check('idempotent',
    L(L('while (a) { }')) === L('while (a) { }'),
    L(L('while (a) { }')));

// The scanner exists for these: a regex would corrupt them.
check('while inside a string literal untouched',
    L('Serial.println("while (x) loop");') === 'Serial.println("while (x) loop");',
    L('Serial.println("while (x) loop");'));
check('for inside a string literal untouched',
    L('OLED.print("for (i)");') === 'OLED.print("for (i)");',
    L('OLED.print("for (i)");'));
check('while inside a line comment untouched',
    L('// while (a) spin\nx = 1;') === '// while (a) spin\nx = 1;',
    L('// while (a) spin\nx = 1;'));
check('while inside a block comment untouched',
    L('/* while (a) { } */ y = 2;') === '/* while (a) { } */ y = 2;',
    L('/* while (a) { } */ y = 2;'));
check('paren inside a string does not break matching',
    L('while (strcmp(s, ")") == 0) { }') ===
    'while (WiFiRuntime.tick(strcmp(s, ")") == 0)) { }',
    L('while (strcmp(s, ")") == 0) { }'));
check('identifier ending in while untouched',
    L('mywhile(a);') === 'mywhile(a);', L('mywhile(a);'));
check('identifier starting with for untouched',
    L('format(a);') === 'format(a);', L('format(a);'));
check('range-for left alone (not the classic three-part form)',
    L('for (auto& x : items) { }') === 'for (auto& x : items) { }',
    L('for (auto& x : items) { }'));
check('unbalanced parens do not corrupt the source',
    L('while (a { }') === 'while (a { }', L('while (a { }'));

// --- 4d. the start gate becomes waitForStart() -------------------------------
// The stock blocks emit exactly `while(!MiniR4.BTN_UP.getState());`
// (control_wait_until wrapping mini_BTNget). Recognising that shape upgrades
// existing student programs into remotely-startable gates with no new block.
check('canonical BTN_UP gate becomes waitForStart',
    L('while(!MiniR4.BTN_UP.getState());') === 'WiFiRuntime.waitForStart();',
    L('while(!MiniR4.BTN_UP.getState());'));
check('spacing variations still recognised',
    L('while ( ! MiniR4.BTN_UP.getState() ) ;') === 'WiFiRuntime.waitForStart();',
    L('while ( ! MiniR4.BTN_UP.getState() ) ;'));
check('BTN_DOWN is NOT a start gate (it is the stop button)',
    L('while(!MiniR4.BTN_DOWN.getState());') ===
    'while(WiFiRuntime.tick(!MiniR4.BTN_DOWN.getState()));',
    L('while(!MiniR4.BTN_DOWN.getState());'));
check('a gate with a body is left as a pumped loop',
    L('while(!MiniR4.BTN_UP.getState()) { x++; }') ===
    'while(WiFiRuntime.tick(!MiniR4.BTN_UP.getState())) { x++; }',
    L('while(!MiniR4.BTN_UP.getState()) { x++; }'));
check('an inverted button test is not a start gate',
    L('while(MiniR4.BTN_UP.getState());') ===
    'while(WiFiRuntime.tick(MiniR4.BTN_UP.getState()));',
    L('while(MiniR4.BTN_UP.getState());'));
check('gate inside a string literal untouched',
    L('Serial.println("while(!MiniR4.BTN_UP.getState());");') ===
    'Serial.println("while(!MiniR4.BTN_UP.getState());");',
    L('Serial.println("while(!MiniR4.BTN_UP.getState());");'));
check('two gates in one program both convert',
    L('while(!MiniR4.BTN_UP.getState()); x=1; while(!MiniR4.BTN_UP.getState());') ===
    'WiFiRuntime.waitForStart(); x=1; WiFiRuntime.waitForStart();',
    L('while(!MiniR4.BTN_UP.getState()); x=1; while(!MiniR4.BTN_UP.getState());'));

// End to end: the reported reproduction must come out pumped.
const repro = A.finish([
    '#include <MatrixMiniR4.h>',
    'void setup() {',
    '  MiniR4.begin();',
    '}',
    'void loop() {',
    '  MiniR4.OLED.print("PRESS UP");',
    '  while(!MiniR4.BTN_UP.getState());',
    '  while(!MiniR4.BTN_DOWN.getState()) { Serial.println(1); }',
    '}',
].join('\n'));
// The start gate becomes waitForStart(); the stop loop stays a pumped loop.
check('reproduction: start gate converted, stop loop pumped',
    repro.includes('WiFiRuntime.waitForStart();') &&
    repro.includes('while(WiFiRuntime.tick(!MiniR4.BTN_DOWN.getState()))') &&
    !repro.includes('while(!MiniR4.BTN_UP.getState())'),
    repro.slice(repro.indexOf('userLoop')));
check('reproduction: the OLED string was not touched',
    repro.includes('MiniR4.OLED.print("PRESS UP")'));
check('reproduction: driver loop still intact',
    /void loop\(\)\n\{\n  WiFiRuntime\.poll\(\);/.test(repro));

// --- 5. malformed input passes through ----------------------------------------

check('no setup/loop passes through', A.finish('int x = 1;') === 'int x = 1;');
check('empty passes through', A.finish('') === '');

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
