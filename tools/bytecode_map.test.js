'use strict';
/*
 * Tests for the live-debug source map produced by bytecode.js.
 *
 * The map is what turns a raw program counter streamed by the robot back
 * into the block a student can see light up, so two properties matter and
 * are asserted here:
 *   1. the marker tokens never reach the program (a byte-for-byte identical
 *      program must come out whether or not markers were emitted);
 *   2. every pc inside a block's byte range resolves to that block.
 *
 * Runs headless: bytecode.js only needs a Blockly.Generator constructor,
 * which we stub with the two methods it actually calls.
 *
 *   node tools/bytecode_map.test.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

let failures = 0;
function check(name, cond, detail) {
    if (cond) { console.log('ok   ' + name); return; }
    failures++;
    console.log('FAIL ' + name + (detail ? '\n     ' + detail : ''));
}

// --- Minimal Blockly stub ----------------------------------------------------
function Generator(name) { this.name_ = name; }
Generator.prototype.blockToCode = function () { return ''; };
Generator.prototype.workspaceToCode = function () { return ''; };

const sandbox = {
    Blockly: { Generator: Generator },
    goog: { provide: function () {}, require: function () {} },
    console: console,
    Number: Number,
    Math: Math,
    Object: Object,
    Uint8Array: Uint8Array,
    Error: Error,
};
vm.createContext(sandbox);
vm.runInContext(
    fs.readFileSync(
        path.join(__dirname, '..', 'resources', 'app_src', 'blockly-core', 'bytecode.js'),
        'utf8'),
    sandbox,
    { filename: 'bytecode.js' });

const BC = sandbox.Blockly.BytecodeVM;

// --- 1. markers are invisible to the program ---------------------------------
// PUSH_I8 7; PUSH_I8 5; ADD; HALT  -> 6 bytes, whatever markers surround it.
const plain   = '02 07 02 05 20 01 ';
const marked  = 'B:0 02 07 B:1 02 05 20 B:2 01 ';

BC._blockIds = [];
const bytesPlain = BC._assemble(plain);

BC._blockIds = ['blkA', 'blkB', 'blkC'];
const bytesMarked = BC._assemble(marked);
const map = BC._blockMap;

check('marked program has the same length',
    bytesPlain.length === bytesMarked.length,
    bytesPlain.length + ' vs ' + bytesMarked.length);
check('marked program is byte-identical',
    Buffer.compare(Buffer.from(bytesPlain), Buffer.from(bytesMarked)) === 0,
    Buffer.from(bytesMarked).toString('hex'));
check('program is the expected 6 bytes',
    Buffer.from(bytesMarked).toString('hex') === '020702052001');

// --- 2. map contents ---------------------------------------------------------
check('one entry per marker', map.length === 3, JSON.stringify(map));
check('entries carry block ids, not indices',
    map.every((e) => typeof e.blockId === 'string'), JSON.stringify(map));
check('pcs are the emission offsets',
    JSON.stringify(map) === JSON.stringify([
        { pc: 0, blockId: 'blkA' },
        { pc: 2, blockId: 'blkB' },
        { pc: 5, blockId: 'blkC' },
    ]), JSON.stringify(map));
check('pcs are non-decreasing',
    map.every((e, i) => i === 0 || map[i - 1].pc <= e.pc));

// --- 3. blockAtPc resolution -------------------------------------------------
check('pc 0 -> first block',  BC.blockAtPc(map, 0) === 'blkA');
check('pc 1 -> still first',  BC.blockAtPc(map, 1) === 'blkA');
check('pc 2 -> second block', BC.blockAtPc(map, 2) === 'blkB');
check('pc 4 -> still second', BC.blockAtPc(map, 4) === 'blkB');
check('pc 5 -> third block',  BC.blockAtPc(map, 5) === 'blkC');
check('pc past the end clamps to the last block',
    BC.blockAtPc(map, 999) === 'blkC');
check('empty map resolves to null', BC.blockAtPc([], 3) === null);
check('missing map resolves to null', BC.blockAtPc(null, 3) === null);

// A pc before the first marker means the setup preamble, which belongs to no
// block — the UI must clear the highlight rather than guess.
check('pc before the first marker resolves to null',
    BC.blockAtPc([{ pc: 4, blockId: 'x' }], 2) === null);

// --- 4. markers do not disturb jump patching ---------------------------------
// L:top; PUSH_I8 1; JMP top; HALT — the relative offset must be identical
// with and without markers, or a debug build would run differently from a
// normal one. This is the failure mode the whole marker design has to avoid.
BC._blockIds = [];
const jumpPlain = BC._assemble('L:top; 02 01 J:top; 01 ');
BC._blockIds = ['a', 'b'];
const jumpMarked = BC._assemble('B:0 L:top; 02 01 B:1 J:top; 01 ');
check('jump offsets unaffected by markers',
    Buffer.compare(Buffer.from(jumpPlain), Buffer.from(jumpMarked)) === 0,
    Buffer.from(jumpPlain).toString('hex') + ' vs ' +
    Buffer.from(jumpMarked).toString('hex'));

// --- 5. an unknown marker index is skipped, not fatal ------------------------
BC._blockIds = ['only'];
const sparse = BC._assemble('B:0 02 01 B:7 01 ');
check('out-of-range marker index is ignored',
    BC._blockMap.length === 1 && BC._blockMap[0].blockId === 'only',
    JSON.stringify(BC._blockMap));
check('out-of-range marker still emits no bytes',
    Buffer.from(sparse).toString('hex') === '020101');

// --- 6. hex tokens starting with 'b' are still hex ---------------------------
// 'b0' is a legitimate opcode byte; only 'B:' introduces a marker. Getting
// this wrong would silently drop instructions.
BC._blockIds = [];
const hexB = BC._assemble('b0 bf 01 ');
check('lowercase b-prefixed hex tokens survive',
    Buffer.from(hexB).toString('hex') === 'b0bf01',
    Buffer.from(hexB).toString('hex'));

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
