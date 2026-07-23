'use strict';
/*
 * Blockly.BytecodeVM handlers for control/setup blocks.
 * Mirror of blockly-core/generator/control.js (Arduino side).
 */
goog.provide('Blockly.BytecodeVM.control');
goog.require('Blockly.BytecodeVM');

// control_setup / mini_setup have TWO substacks in MATRIXblock:
//   SUBSTACK  -- setup body, runs once at boot -> _setupCode preamble
//   SUBSTACK2 -- main loop body, runs forever  -> returned as main body
// The Arduino generator glues SUBSTACK2 into loops_['loop']; we return it
// so finish() wraps it in the main-label -> J:main loop.
//
// The setup block also carries three fields (battery cell count, UART enable,
// baud rate) that only matter for the C++ side (they configure Serial and
// battery calibration). The VM does not need them, so we ignore them here.
Blockly.BytecodeVM['control_setup'] = function () {
    const G = Blockly.BytecodeVM;
    const setupBody = G.statementToCode(this, 'SUBSTACK')  || '';
    const loopBody  = G.statementToCode(this, 'SUBSTACK2') || '';
    if (setupBody.trim().length) {
        G._setupCode += setupBody;
    }
    return loopBody;
};
Blockly.BytecodeVM['mini_setup'] = Blockly.BytecodeVM['control_setup'];

// control_wait -- MATRIXblock's TIMES is already in milliseconds (matches
// the Arduino generator which emits `delay(TIMES)` verbatim). No unit
// conversion needed; just push the value and drop into DELAY_MS.
Blockly.BytecodeVM['control_wait'] = function () {
    const G = Blockly.BytecodeVM;
    const ms = G.valueToCode(this, 'TIMES', G.ORDER_ATOMIC) || G.pushInt(0);
    return ms + G.byte(G.OPS.DELAY_MS);
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
