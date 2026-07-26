'use strict';
/*
 * Blockly.BytecodeVM handlers for data / variable blocks.
 * The Arduino side uses variableDB_ to make C identifiers; here we just
 * map each Blockly variable id to a fixed slot 0..15.
 */
goog.provide('Blockly.BytecodeVM.data');
goog.require('Blockly.BytecodeVM');

Blockly.BytecodeVM['data_variable'] = function (block) {
    const G = Blockly.BytecodeVM;
    const id = block.getFieldValue('VARIABLE');
    const slot = G.varSlot(id);
    return [G.byte(G.OPS.LOAD_VAR) + G.byte(slot), G.ORDER_ATOMIC];
};

Blockly.BytecodeVM['data_setvariableto'] = function () {
    const G = Blockly.BytecodeVM;
    const id = this.getFieldValue('VARIABLE') || 'null';
    const slot = G.varSlot(id);
    const val = G.valueToCode(this, 'VALUE', G.ORDER_ATOMIC) || G.pushInt(0);
    return val + G.byte(G.OPS.STORE_VAR) + G.byte(slot);
};

Blockly.BytecodeVM['data_changevariableby'] = function () {
    const G = Blockly.BytecodeVM;
    const id = this.getFieldValue('VARIABLE') || 'null';
    const slot = G.varSlot(id);
    const val = G.valueToCode(this, 'VALUE', G.ORDER_ATOMIC) || G.pushInt(0);
    // v = v + delta
    return G.byte(G.OPS.LOAD_VAR) + G.byte(slot) +
           val +
           G.byte(G.OPS.ADD) +
           G.byte(G.OPS.STORE_VAR) + G.byte(slot);
};
