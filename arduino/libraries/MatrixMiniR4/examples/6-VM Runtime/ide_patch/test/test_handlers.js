'use strict';
/*
 * Integration test: exercises the generator handlers by faking a Blockly
 * workspace traversal. Verifies the emitted token stream assembles to a
 * program the MiniR4VM would happily execute.
 *
 * Usage:  node test_handlers.js
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

const G = sandbox.Blockly.BytecodeVM;

// ---- Mock block factories ------------------------------------------------
function mkBlock(type, fields, values, statements) {
    fields = fields || {};
    values = values || {};
    statements = statements || {};
    return {
        type,
        _fields: fields,
        _values: values,
        _statements: statements,
        getFieldValue(name) { return this._fields[name]; },
        getField(name) { return name in this._fields ? { name } : null; },
        nextConnection: null,
    };
}

// Bind G.valueToCode/statementToCode to walk our mock tree.
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
    const handler = G[child.type];
    if (!handler) throw new Error('no handler for ' + child.type);
    return handler.call(child, child) || '';
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

// ---- Test A: math_number ----------------------------------------------------
G.init({});
{
    const b = mkBlock('math_number', { NUM: '42' });
    const [tok] = G['math_number'].call(b, b);
    assertEq(assemble(tok), [0x02, 0x2A], 'math_number 42 -> PUSH_I8 42');
}

// ---- Test B: operator_add of two literals -----------------------------------
G.init({});
{
    const add = mkBlock('operator_add', {}, {
        NUM1: mkBlock('math_number', { NUM: '3' }),
        NUM2: mkBlock('math_number', { NUM: '4' }),
    });
    const [tok] = G['operator_add'].call(add, add);
    // PUSH_I8 3, PUSH_I8 4, ADD
    assertEq(assemble(tok),
        [0x02, 0x03, 0x02, 0x04, 0x20],
        'operator_add(3,4) -> PUSH 3, PUSH 4, ADD');
}

// ---- Test C: data_setvariableto = 7, then data_variable get ----------------
G.init({});
{
    const set = mkBlock('data_setvariableto', { VARIABLE: 'v1' }, {
        VALUE: mkBlock('math_number', { NUM: '7' }),
    });
    const setTok = G['data_setvariableto'].call(set, set);
    const get = mkBlock('data_variable', { VARIABLE: 'v1' });
    const [getTok] = G['data_variable'].call(get, get);
    // set: PUSH_I8 7, STORE_VAR 0
    // get: LOAD_VAR 0
    assertEq(assemble(setTok),
        [0x02, 0x07, 0x11, 0x00],
        'setvariableto v1=7 -> PUSH 7, STORE_VAR 0');
    assertEq(assemble(getTok),
        [0x10, 0x00],
        'data_variable v1 -> LOAD_VAR 0 (same slot)');
}

// ---- Test D: control_if (cond -> body) --------------------------------------
G.init({});
{
    const wait = mkBlock('control_wait', {}, {
        TIMES: mkBlock('math_number', { NUM: '1' }),
    });
    const iff = mkBlock('control_if', {}, {
        CONDITION: mkBlock('operator_const_bool', { ARGUMENT: 'true' }),
    }, {
        SUBSTACK: wait,
    });
    const tok = G['control_if'].call(iff, iff);
    const bytes = assemble(tok);
    // cond: PUSH_I8 1 (true)
    // JMP_IF_NOT end
    // body: PUSH_I8 1 (secs) PUSH_I16 1000 MUL DELAY_MS
    // end:
    // Expected layout (control_wait TIMES is milliseconds now):
    //   0: 02 01           PUSH_I8 1        (bool true)
    //   2: 52 <off_lo> <off_hi>   JMP_IF_NOT end
    //   5: 02 01           PUSH_I8 1        (ms)
    //   7: 60              DELAY_MS
    //   8: (end)
    // offset from 5 to 8 = 3
    assertEq(bytes,
        [0x02, 0x01, 0x52, 0x03, 0x00, 0x02, 0x01, 0x60],
        'control_if(true) { wait 1ms } -> conditional wait');
}

// ---- Test E: control_repeat 3 { wait 1s } ----------------------------------
G.init({});
{
    const wait = mkBlock('control_wait', {}, {
        TIMES: mkBlock('math_number', { NUM: '1' }),
    });
    const rep = mkBlock('control_repeat', {}, {
        TIMES: mkBlock('math_number', { NUM: '3' }),
    }, {
        SUBSTACK: wait,
    });
    const tok = G['control_repeat'].call(rep, rep);
    const bytes = assemble(tok);
    // Layout (control_wait TIMES is milliseconds now):
    //   0: 02 00 11 0F        i=0; STORE_VAR 15
    //   4: 10 0F 02 03 32     LOAD_VAR 15; PUSH_I8 3; LT
    //   9: 52 __ __           JMP_IF_NOT end
    //  12: 02 01 60           body: wait 1ms (3 bytes)
    //  15: 10 0F 02 01 20 11 0F   inc: LOAD 15; PUSH 1; ADD; STORE 15 (7 bytes)
    //  22: 50 __ __           JMP loop
    //  25: (end)
    // JMP_IF_NOT: from 12 to 25 = 13
    // JMP:        from 25 to 4  = -21 -> 0xEB 0xFF
    assertEq(bytes,
        [
            0x02, 0x00, 0x11, 0x0F,
            0x10, 0x0F, 0x02, 0x03, 0x32,
            0x52, 0x0D, 0x00,
            0x02, 0x01, 0x60,
            0x10, 0x0F, 0x02, 0x01, 0x20, 0x11, 0x0F,
            0x50, 0xEB, 0xFF,
        ],
        'control_repeat 3 { wait 1ms } -> counted loop with scratch slot 15');
}

// ---- Test F: warnings surface unsupported blocks ---------------------------
G.init({});
{
    const j = mkBlock('operator_join', {}, {
        STRING1: mkBlock('math_number', { NUM: '1' }),
        STRING2: mkBlock('math_number', { NUM: '2' }),
    });
    G['operator_join'].call(j, j);
    if (G._warnings.length !== 1 || G._warnings[0].block !== 'operator_join') {
        console.error('FAIL warning for operator_join not recorded');
        process.exitCode = 1;
    } else {
        console.log('ok    operator_join records a warning');
    }
}

console.log(process.exitCode ? '\nFAILED' : '\nAll handler tests passed.');
