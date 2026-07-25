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

// --- 5. malformed input passes through ----------------------------------------

check('no setup/loop passes through', A.finish('int x = 1;') === 'int x = 1;');
check('empty passes through', A.finish('') === '');

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
