'use strict';
/*
 * Blockly.BytecodeVM handlers for control/setup blocks.
 * Mirror of blockly-core/generator/control.js (Arduino side).
 */
goog.provide('Blockly.BytecodeVM.control');
goog.require('Blockly.BytecodeVM');

// control_setup / mini_setup — collect body into _setupCode, emit nothing.
Blockly.BytecodeVM['control_setup'] = function () {
    const branch = Blockly.BytecodeVM.statementToCode(this, 'SUBSTACK');
    if (branch && branch.trim().length) {
        Blockly.BytecodeVM._setupCode += branch;
    }
    return '';
};
Blockly.BytecodeVM['mini_setup'] = Blockly.BytecodeVM['control_setup'];

// control_wait — Blockly's TIMES is seconds; VM DELAY_MS is milliseconds.
Blockly.BytecodeVM['control_wait'] = function () {
    const G = Blockly.BytecodeVM;
    const secs = G.valueToCode(this, 'TIMES', G.ORDER_ATOMIC) || G.pushInt(0);
    return secs + G.pushInt(1000) + G.byte(G.OPS.MUL) + G.byte(G.OPS.DELAY_MS);
};

Blockly.BytecodeVM['control_if'] = function () {
    const G = Blockly.BytecodeVM;
    const cond = G.valueToCode(this, 'CONDITION', G.ORDER_NONE) || G.pushInt(0);
    const body = G.statementToCode(this, 'SUBSTACK');
    const endLbl = G.newLabel('endif');
    return cond + 'JN:' + endLbl + '; ' + body + 'L:' + endLbl + '; ';
};

Blockly.BytecodeVM['control_if_else'] = function () {
    const G = Blockly.BytecodeVM;
    const cond = G.valueToCode(this, 'CONDITION', G.ORDER_NONE) || G.pushInt(0);
    const body = G.statementToCode(this, 'SUBSTACK');
    const elseBody = G.statementToCode(this, 'SUBSTACK2');
    const elseLbl = G.newLabel('else');
    const endLbl = G.newLabel('endif');
    return cond + 'JN:' + elseLbl + '; ' + body +
           'J:' + endLbl + '; ' +
           'L:' + elseLbl + '; ' + elseBody +
           'L:' + endLbl + '; ';
};

Blockly.BytecodeVM['control_forever'] = function () {
    const G = Blockly.BytecodeVM;
    const body = G.statementToCode(this, 'SUBSTACK');
    const lbl = G.newLabel('forever');
    return 'L:' + lbl + '; ' + body + 'J:' + lbl + '; ';
};

Blockly.BytecodeVM['control_repeat'] = function () {
    const G = Blockly.BytecodeVM;
    const slot = G.pushScratchSlot();
    const times = G.valueToCode(this, 'TIMES', G.ORDER_ATOMIC) || G.pushInt(0);
    const body = G.statementToCode(this, 'SUBSTACK');
    G.popScratchSlot();

    const loopLbl = G.newLabel('rep');
    const endLbl = G.newLabel('endrep');
    const load  = G.byte(G.OPS.LOAD_VAR)  + G.byte(slot);
    const store = G.byte(G.OPS.STORE_VAR) + G.byte(slot);

    // i = 0
    // LOOP: if !(i < TIMES) goto END
    //       body
    //       i = i + 1
    //       goto LOOP
    // END:
    const init = G.pushInt(0) + store;
    const cond = load + times + G.byte(G.OPS.LT);
    const inc  = load + G.pushInt(1) + G.byte(G.OPS.ADD) + store;
    return init +
        'L:' + loopLbl + '; ' + cond + 'JN:' + endLbl + '; ' +
        body + inc + 'J:' + loopLbl + '; ' +
        'L:' + endLbl + '; ';
};

// while (cond) yield 1ms
Blockly.BytecodeVM['control_wait_until'] = function () {
    const G = Blockly.BytecodeVM;
    const cond = G.valueToCode(this, 'CONDITION', G.ORDER_NONE) || G.pushInt(0);
    const loopLbl = G.newLabel('wu');
    const endLbl = G.newLabel('endwu');
    return 'L:' + loopLbl + '; ' + cond + 'JI:' + endLbl + '; ' +
           G.pushInt(1) + G.byte(G.OPS.DELAY_MS) + 'J:' + loopLbl + '; ' +
           'L:' + endLbl + '; ';
};

Blockly.BytecodeVM['control_repeat_until'] = function () {
    const G = Blockly.BytecodeVM;
    const cond = G.valueToCode(this, 'CONDITION', G.ORDER_NONE) || G.pushInt(0);
    const body = G.statementToCode(this, 'SUBSTACK');
    const loopLbl = G.newLabel('ru');
    const endLbl = G.newLabel('endru');
    return 'L:' + loopLbl + '; ' + cond + 'JI:' + endLbl + '; ' +
           body + 'J:' + loopLbl + '; ' +
           'L:' + endLbl + '; ';
};
