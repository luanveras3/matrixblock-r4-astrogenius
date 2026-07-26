'use strict';
/*
 * Blockly.BytecodeVM handlers for arithmetic / comparison / logic operators.
 *
 * All value blocks return [tokens, ORDER_ATOMIC]. Since bytecode composition
 * happens through stack pushes (not textual embedding), precedence is
 * meaningless — we never need to wrap in parens.
 *
 * Unsupported blocks (strings, letters, float math ops) call G.warn() and
 * pass their first operand through so the program still assembles.
 */
goog.provide('Blockly.BytecodeVM.operators');
goog.require('Blockly.BytecodeVM');

(function () {
    const G = Blockly.BytecodeVM;

    function binOp(inA, inB, opByte, defA, defB) {
        return function () {
            const a = G.valueToCode(this, inA, G.ORDER_ATOMIC) || G.pushInt(defA || 0);
            const b = G.valueToCode(this, inB, G.ORDER_ATOMIC) || G.pushInt(defB || 0);
            return [a + b + G.byte(opByte), G.ORDER_ATOMIC];
        };
    }

    G['operator_add']      = binOp('NUM1', 'NUM2', G.OPS.ADD);
    G['operator_subtract'] = binOp('NUM1', 'NUM2', G.OPS.SUB);
    G['operator_multiply'] = binOp('NUM1', 'NUM2', G.OPS.MUL);
    G['operator_divide']   = binOp('NUM1', 'NUM2', G.OPS.DIV, 0, 1);
    G['operator_mod']      = binOp('NUM1', 'NUM2', G.OPS.MOD, 1, 1);
    G['operator_random']   = binOp('FROM', 'TO',   G.OPS.RANDOM, 0, 1);

    G['operator_lt']       = binOp('OPERAND1', 'OPERAND2', G.OPS.LT);
    G['operator_gt']       = binOp('OPERAND1', 'OPERAND2', G.OPS.GT);
    G['operator_equals']   = binOp('OPERAND1', 'OPERAND2', G.OPS.EQ);
    G['operator_and']      = binOp('OPERAND1', 'OPERAND2', G.OPS.AND);
    G['operator_or']       = binOp('OPERAND1', 'OPERAND2', G.OPS.OR);

    G['operator_not'] = function () {
        const a = G.valueToCode(this, 'OPERAND', G.ORDER_ATOMIC) || G.pushInt(0);
        return [a + G.byte(G.OPS.NOT), G.ORDER_ATOMIC];
    };

    G['operator_round'] = function () {
        const a = G.valueToCode(this, 'NUM', G.ORDER_ATOMIC) || G.pushInt(0);
        return [a + G.byte(G.OPS.ROUND), G.ORDER_ATOMIC];
    };

    // constrain(v, min, max) = MAX(MIN(v, max), min)
    G['operator_constrain'] = function () {
        const v   = G.valueToCode(this, 'NUM', G.ORDER_ATOMIC) || G.pushInt(50);
        const mn  = G.valueToCode(this, 'MIN', G.ORDER_ATOMIC) || G.pushInt(0);
        const mx  = G.valueToCode(this, 'MAX', G.ORDER_ATOMIC) || G.pushInt(100);
        return [
            v + mx + G.byte(G.OPS.MIN) +
                mn + G.byte(G.OPS.MAX),
            G.ORDER_ATOMIC
        ];
    };

    G['operator_const_bool'] = function () {
        const val = this.getFieldValue('ARGUMENT');
        return [G.pushInt(val === 'true' ? 1 : 0), G.ORDER_ATOMIC];
    };

    // ---- Unsupported in the VM today ---------------------------------------
    // operator_mathop covers sqrt/sin/cos/tan/asin/acos/atan/ln/log10/exp/10^.
    // These need the MATHFN opcode (fixed-point ×100) which isn't implemented.
    G['operator_mathop'] = function () {
        const fn = this.getFieldValue('OPERATOR');
        G.warn('operator_mathop',
            'Math function "' + fn + '" needs the MATHFN opcode (not yet on ' +
            'the R4 runtime). Value passed through unchanged.');
        const a = G.valueToCode(this, 'NUM', G.ORDER_ATOMIC) || G.pushInt(0);
        return [a, G.ORDER_ATOMIC];
    };

    // String ops — VM has no string subsystem yet. Emit a zero so the program
    // still assembles and warn the user.
    function unsupported(name, reason) {
        G[name] = function () {
            G.warn(name, reason);
            return [G.pushInt(0), G.ORDER_ATOMIC];
        };
    }
    unsupported('operator_join',
        'Text concatenation not supported by the BLE runtime (needs strings).');
    unsupported('operator_join_three',
        'Text concatenation not supported by the BLE runtime (needs strings).');
    unsupported('operator_letter_of',
        'String indexing not supported by the BLE runtime.');
    unsupported('operator_length',
        'String length not supported by the BLE runtime.');
    unsupported('operator_toString',
        'toString() not supported (VM has no string type). Use USB upload.');
    unsupported('operator_toFloat',
        'toFloat() not supported (VM is int32 only). Use USB upload.');
})();
