'use strict';
/*
 * Integration test for the Scratch-style procedures compiler.
 * Fakes a Blockly workspace with procedures_definition + procedures_call and
 * checks the emitted token stream assembles to the expected bytes.
 *
 * Usage:  node test_procedures.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---- Load bytecode.js + handlers into a shared sandbox -------------------
const sandbox = { goog: { provide: () => {}, require: () => {} }, console };
sandbox.Blockly = { Generator: function () {} };
Object.assign(sandbox.Blockly.Generator.prototype, {
    blockToCode: function () { return ''; },
    statementToCode: function () { return ''; },
    valueToCode: function () { return ''; },
    workspaceToCode: function () { return ''; },
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
load('generator_bytecode/procedures.js');

const G = sandbox.Blockly.BytecodeVM;

// ---- Mock block factories ------------------------------------------------
function mkBlock(type, fields, opts) {
    fields = fields || {};
    opts = opts || {};
    return {
        type,
        _fields: fields,
        _values: opts.values || {},
        _statements: opts.statements || {},
        childBlocks_: opts.childBlocks || [],
        procCode_: opts.procCode,
        displayNames_: opts.displayNames,
        argumentIds_: opts.argumentIds,
        _next: opts.next || null,
        getFieldValue(name) { return this._fields[name]; },
        getInputTargetBlock(name) { return this._values[name] || null; },
        getNextBlock() { return this._next; },
        nextConnection: opts.next ? { targetBlock: () => opts.next } : null,
    };
}

// Wire valueToCode / statementToCode / blockToCode to walk our mock tree
// with the same scrub_ chaining Blockly uses.
G.valueToCode = function (block, name /*, order */) {
    const child = block._values[name];
    if (!child) return '';
    const handler = G[child.type];
    if (!handler) throw new Error('no handler for ' + child.type);
    const result = handler.call(child, child);
    return Array.isArray(result) ? result[0] : (result || '');
};
G.statementToCode = function (block, name) {
    const child = block._statements[name];
    if (!child) return '';
    return G.blockToCode(child);
};
G.blockToCode = function (block) {
    if (!block) return '';
    const handler = G[block.type];
    if (!handler) throw new Error('no handler for ' + block.type);
    const result = handler.call(block, block);
    let code = Array.isArray(result) ? result[0] : (result || '');
    // scrub_ tail: recurse into nextConnection chain
    const nxt = block.nextConnection && block.nextConnection.targetBlock();
    if (nxt) code += G.blockToCode(nxt);
    return code;
};

function assemble(tokens) { return Array.from(G._assemble(tokens)); }
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

// mock workspace whose getTopBlocks returns a fixed set for _scanProcs.
function mkWorkspace(topBlocks) {
    return { getTopBlocks: () => topBlocks };
}

// ---- Test A: no-arg procedure, called from main -------------------------
{
    // proto: procCode "beep", 0 args
    const proto = mkBlock('procedures_prototype', {}, {
        procCode: 'beep', displayNames: [], childBlocks: [],
    });
    // body: wait 1ms
    const wait = mkBlock('control_wait', {}, {
        values: { TIMES: mkBlock('math_number', { NUM: '1' }) },
    });
    // definition wrapping the prototype, with wait as next
    const def = mkBlock('procedures_definition', {}, {
        childBlocks: [proto], next: wait,
    });
    // caller: procedures_call procCode "beep"
    const call = mkBlock('procedures_call', {}, {
        procCode: 'beep', argumentIds: [],
    });

    const ws = mkWorkspace([def, call]);
    G.init(ws);

    // emit main = call block; emit def separately (handler returns null,
    // populates _procCode).
    G['procedures_definition'].call(def, def);
    const mainTok = G['procedures_call'].call(call, call);

    // finish() glues everything: setup + main + HALT + procCode
    const full = G.finish(mainTok);
    const bytes = assemble(full);

    // Expected layout:
    //   main: 0: C:proc_0 (CALL abs)  -> 53 <lo> <hi>
    //         3: J:main               -> 50 <off_lo> <off_hi>
    //         6: HALT                 -> 01
    //         7: L:proc_0             (no args -> no prelude)
    //         7: PUSH_I8 1            -> 02 01
    //         9: DELAY_MS             -> 60
    //        10: RET                  -> 54
    // CALL target = 7  -> 07 00
    // JMP main: from pc-after (6) back to 0  = -6 -> FA FF
    assertEq(bytes,
        [
            0x53, 0x07, 0x00,
            0x50, 0xFA, 0xFF,
            0x01,
            0x02, 0x01, 0x60, 0x54,
        ],
        'no-arg proc "beep" { wait 1ms } called from main');
}

// ---- Test B: 1-arg proc, arg used in body via reporter -------------------
{
    // proto: procCode "wait_ms %s", 1 num arg named "ms"
    const argReporterInProto = mkBlock('argument_reporter_string_number',
        { VALUE: 'ms' }, {});
    const proto = mkBlock('procedures_prototype', {}, {
        procCode: 'wait_ms %s', displayNames: ['ms'],
        childBlocks: [argReporterInProto],
    });
    // body: control_wait TIMES = argument_reporter_string_number("ms")
    const argReporterInBody = mkBlock('argument_reporter_string_number',
        { VALUE: 'ms' }, {});
    const wait = mkBlock('control_wait', {}, {
        values: { TIMES: argReporterInBody },
    });
    const def = mkBlock('procedures_definition', {}, {
        childBlocks: [proto], next: wait,
    });
    // caller: pass 5 as argument
    const call = mkBlock('procedures_call', {}, {
        procCode: 'wait_ms %s',
        argumentIds: ['ARG0'],
        values: { ARG0: mkBlock('math_number', { NUM: '5' }) },
    });

    const ws = mkWorkspace([def, call]);
    G.init(ws);
    G['procedures_definition'].call(def, def);
    const mainTok = G['procedures_call'].call(call, call);
    const full = G.finish(mainTok);
    const bytes = assemble(full);

    // slot 0 = "ms" (proc:wait_ms %s:ms) — only var registered.
    // Expected:
    //   main: 0: PUSH_I8 5         02 05
    //         2: CALL proc_0       53 09 00
    //         5: J:main            50 F8 FF     (target 0; pc-after 8 -> -8)
    //         8: HALT              01
    //         9: STORE_VAR 0       11 00        (prelude: pop the 5)
    //        11: LOAD_VAR 0        10 00        (body: reporter -> slot 0)
    //        13: DELAY_MS          60
    //        14: RET               54
    assertEq(bytes,
        [
            0x02, 0x05,
            0x53, 0x09, 0x00,
            0x50, 0xF8, 0xFF,
            0x01,
            0x11, 0x00,
            0x10, 0x00,
            0x60,
            0x54,
        ],
        '1-arg proc "wait_ms(ms)" wait ms; called with 5');
}

// ---- Test C: 2-arg proc, args popped in reverse -------------------------
{
    // proto: procCode "add %s %s", 2 args a, b
    const argA = mkBlock('argument_reporter_string_number',
        { VALUE: 'a' }, {});
    const argB = mkBlock('argument_reporter_string_number',
        { VALUE: 'b' }, {});
    const proto = mkBlock('procedures_prototype', {}, {
        procCode: 'add %s %s', displayNames: ['a', 'b'],
        childBlocks: [argA, argB],
    });
    // body is empty — we only care about the prelude order
    const def = mkBlock('procedures_definition', {}, {
        childBlocks: [proto], next: null,
    });
    const call = mkBlock('procedures_call', {}, {
        procCode: 'add %s %s',
        argumentIds: ['ARG0', 'ARG1'],
        values: {
            ARG0: mkBlock('math_number', { NUM: '3' }),
            ARG1: mkBlock('math_number', { NUM: '4' }),
        },
    });

    const ws = mkWorkspace([def, call]);
    G.init(ws);
    G['procedures_definition'].call(def, def);
    const mainTok = G['procedures_call'].call(call, call);
    const full = G.finish(mainTok);
    const bytes = assemble(full);

    // slots: a=0, b=1 (allocation order in _scanProcs).
    // caller pushes a=3 then b=4 -> stack (top) 4, then 3.
    // callee prelude stores in reverse: STORE_VAR 1 (b<-4), STORE_VAR 0 (a<-3).
    //
    //   main:
    //     0: PUSH_I8 3       02 03
    //     2: PUSH_I8 4       02 04
    //     4: CALL proc_0     53 0B 00
    //     7: J:main          50 F6 FF   (target 0; pc-after 10 -> -10)
    //    10: HALT            01
    //    11: STORE_VAR 1     11 01
    //    13: STORE_VAR 0     11 00
    //    15: RET             54
    assertEq(bytes,
        [
            0x02, 0x03,
            0x02, 0x04,
            0x53, 0x0B, 0x00,
            0x50, 0xF6, 0xFF,
            0x01,
            0x11, 0x01,
            0x11, 0x00,
            0x54,
        ],
        '2-arg proc "add(a,b)" callee pops b first, then a');
}

// ---- Test D: two calls to same proc share the same label ----------------
{
    const proto = mkBlock('procedures_prototype', {}, {
        procCode: 'noop', displayNames: [], childBlocks: [],
    });
    const def = mkBlock('procedures_definition', {}, {
        childBlocks: [proto], next: null,
    });
    const call1 = mkBlock('procedures_call', {}, {
        procCode: 'noop', argumentIds: [],
    });
    const call2 = mkBlock('procedures_call', {}, {
        procCode: 'noop', argumentIds: [],
    });

    const ws = mkWorkspace([def, call1, call2]);
    G.init(ws);
    G['procedures_definition'].call(def, def);
    const tok = G['procedures_call'].call(call1, call1) +
                G['procedures_call'].call(call2, call2);
    const full = G.finish(tok);
    const bytes = assemble(full);

    // Two CALLs to the same absolute target.
    //   0: CALL proc_0    53 09 00
    //   3: CALL proc_0    53 09 00
    //   6: J:main         50 F7 FF     (target 0; pc-after 9 -> -9)
    //   9: HALT           01
    //  10: RET            54          (empty body, no args)
    // CALL target = 10 -> 0A 00
    assertEq(bytes,
        [
            0x53, 0x0A, 0x00,
            0x53, 0x0A, 0x00,
            0x50, 0xF7, 0xFF,
            0x01,
            0x54,
        ],
        'two calls to same proc share the CALL target');
}

// ---- Test E: call to undefined proc records a warning -------------------
{
    const call = mkBlock('procedures_call', {}, {
        procCode: 'ghost', argumentIds: [],
    });
    const ws = mkWorkspace([call]);   // no definition
    G.init(ws);
    G._warnings.length = 0;
    const tok = G['procedures_call'].call(call, call);
    if (tok !== '' ||
        G._warnings.length !== 1 ||
        G._warnings[0].block !== 'procedures_call') {
        console.error(
            'FAIL undefined-proc call did not warn cleanly',
            { tok: tok, warnings: G._warnings });
        process.exitCode = 1;
    } else {
        console.log('ok    call to undefined proc records a warning');
    }
}

// ---- Test F: string arg reporter warns and emits 0 ----------------------
{
    G.init(mkWorkspace([]));
    G._warnings.length = 0;
    G._currentProc = {
        key: 'p', label: 'proc_0',
        argNames: ['s'], argSlots: [-1],
    };
    const rep = mkBlock('argument_reporter_string_only',
        { VALUE: 's' }, {});
    const [tok] = G['argument_reporter_string_only'].call(rep, rep);
    G._currentProc = null;
    // PUSH_I8 0
    assertEq(assemble(tok), [0x02, 0x00],
        'argument_reporter_string_only emits PUSH_I8 0');
    if (G._warnings.length !== 1) {
        console.error('FAIL string reporter should warn');
        process.exitCode = 1;
    } else {
        console.log('ok    string reporter records a warning');
    }
}

console.log(process.exitCode ? '\nFAILED' : '\nAll procedures tests passed.');
