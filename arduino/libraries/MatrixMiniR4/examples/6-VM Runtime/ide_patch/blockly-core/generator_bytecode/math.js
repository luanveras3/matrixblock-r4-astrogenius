'use strict';
/*
 * Blockly.BytecodeVM handlers for math literal blocks.
 * VM has no float type; math_angle is truncated to int (0..360 unchanged).
 */
goog.provide('Blockly.BytecodeVM.math');
goog.require('Blockly.BytecodeVM');

Blockly.BytecodeVM['math_number'] = function () {
    const G = Blockly.BytecodeVM;
    const raw = this.getFieldValue('NUM');
    const n = parseFloat(raw);
    if (Number.isNaN(n)) {
        G.warn('math_number', 'Non-numeric literal "' + raw + '" replaced with 0.');
        return [G.pushInt(0), G.ORDER_ATOMIC];
    }
    if (n !== Math.trunc(n)) {
        G.warn('math_number',
            'MiniR4VM has no float type; ' + n + ' truncated to ' + (n | 0) + '.');
    }
    return [G.pushInt(n | 0), G.ORDER_ATOMIC];
};

// Aliases — same behavior as math_number.
Blockly.BytecodeVM['math_integer']      = Blockly.BytecodeVM['math_number'];
Blockly.BytecodeVM['math_whole_number'] = Blockly.BytecodeVM['math_number'];
Blockly.BytecodeVM['math_angle']        = Blockly.BytecodeVM['math_number'];
