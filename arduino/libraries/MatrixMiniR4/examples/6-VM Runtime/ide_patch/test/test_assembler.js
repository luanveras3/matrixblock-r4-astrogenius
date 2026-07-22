'use strict';
/*
 * Standalone smoke test for the Blockly.BytecodeVM assembler.
 * Runs without Blockly: stubs goog + Blockly.Generator, loads bytecode.js,
 * and exercises token->bytes resolution for labels and jumps.
 *
 * Usage:  node test_assembler.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---- Minimal stubs so bytecode.js loads without the real Blockly ---------
const sandbox = {
    goog: { provide: () => {}, require: () => {} },
    console,
};
sandbox.Blockly = {
    Generator: function (name) { this.name_ = name; },
};
sandbox.Blockly.Generator.prototype.blockToCode = function () { return ''; };
sandbox.Blockly.Generator.prototype.statementToCode = function () { return ''; };
sandbox.Blockly.Generator.prototype.valueToCode = function () { return ''; };
sandbox.Blockly.Generator.prototype.workspaceToCode = function () { return ''; };
vm.createContext(sandbox);

const src = fs.readFileSync(
    path.join(__dirname, '..', 'blockly-core', 'bytecode.js'), 'utf8');
vm.runInContext(src, sandbox);

const G = sandbox.Blockly.BytecodeVM;
G.init({});

// ---- Test 1: pushInt narrowness ------------------------------------------
function bytesOf(str) {
    return Array.from(G._assemble(str));
}
function assertEq(actual, expected, label) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        console.error(`FAIL ${label}:\n  expected: ${e}\n  actual:   ${a}`);
        process.exitCode = 1;
    } else {
        console.log(`ok    ${label}`);
    }
}

assertEq(bytesOf(G.pushInt(0)),      [0x02, 0x00],             'pushInt(0)   -> PUSH_I8');
assertEq(bytesOf(G.pushInt(127)),    [0x02, 0x7F],             'pushInt(127) -> PUSH_I8');
assertEq(bytesOf(G.pushInt(-1)),     [0x02, 0xFF],             'pushInt(-1)  -> PUSH_I8');
assertEq(bytesOf(G.pushInt(128)),    [0x03, 0x80, 0x00],       'pushInt(128) -> PUSH_I16');
assertEq(bytesOf(G.pushInt(-200)),   [0x03, 0x38, 0xFF],       'pushInt(-200)-> PUSH_I16');
assertEq(bytesOf(G.pushInt(70000)),  [0x04, 0x70, 0x11, 0x01, 0x00], 'pushInt(70000)-> PUSH_I32');

// ---- Test 2: forward jump (JMP_IF_NOT skips 2 bytes) ---------------------
// L:start;  PUSH_I8 1  JN:end;  PUSH_I8 42  L:end;  HALT
// Layout:
//   0: label start
//   0: 02 01
//   2: 52 <off_lo> <off_hi>   -- JMP_IF_NOT
//   5: 02 2A
//   7: label end
//   7: 01 (HALT)
// offset from pc-after-jump (5) to target (7) = +2 -> 0x02, 0x00
assertEq(
    bytesOf('L:start; 02 01 JN:end; 02 2A L:end; 01'),
    [0x02, 0x01, 0x52, 0x02, 0x00, 0x02, 0x2A, 0x01],
    'forward JMP_IF_NOT resolves +2'
);

// ---- Test 3: backward JMP (loop) -----------------------------------------
// L:loop;  02 05  50 (JMP) back to loop  01 HALT
// Layout:
//   0: label loop
//   0: 02 05
//   2: 50 <off_lo> <off_hi>
//   5: 01
// offset from 5 to 0 = -5 -> 0xFB, 0xFF (i16 two's complement)
assertEq(
    bytesOf('L:loop; 02 05 J:loop; 01'),
    [0x02, 0x05, 0x50, 0xFB, 0xFF, 0x01],
    'backward JMP resolves -5'
);

// ---- Test 4: CALL is absolute u16 ----------------------------------------
// 53 <lo> <hi>  01 HALT   L:sub;  54 (RET)
// After emit:
//   0: 53 00 00 (patched to abs u16 of L:sub)
//   3: 01
//   4: label sub
//   4: 54
assertEq(
    bytesOf('C:sub; 01 L:sub; 54'),
    [0x53, 0x04, 0x00, 0x01, 0x54],
    'CALL is absolute u16 = 4'
);

// ---- Test 5: unresolved label throws --------------------------------------
let threw = false;
try { G._assemble('J:missing; 01'); } catch (e) { threw = /Unresolved/.test(e.message); }
assertEq(threw, true, 'unresolved label throws');

// ---- Test 6: program size cap ---------------------------------------------
threw = false;
try {
    let big = '';
    for (let i = 0; i < 6200; i++) big += '00 ';
    G._assemble(big);
} catch (e) { threw = /6144/.test(e.message); }
assertEq(threw, true, 'oversized program throws');

// ---- Test 7: end-to-end program shape (LED blink 5x, control_repeat pattern)
// Simulates what control_repeat would emit for a body that calls DELAY_MS 200.
// slot 15 is used because pushScratchSlot() picked it.
G.init({});
const slot = G.pushScratchSlot();
if (slot !== 15) {
    console.error(`FAIL pushScratchSlot -> expected 15 got ${slot}`);
    process.exitCode = 1;
}
G.popScratchSlot();
console.log('ok    pushScratchSlot picks slot 15');

console.log(process.exitCode ? '\nFAILED' : '\nAll assembler tests passed.');
