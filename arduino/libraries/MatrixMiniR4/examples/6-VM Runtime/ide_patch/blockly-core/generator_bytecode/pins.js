'use strict';
/*
 * Blockly.BytecodeVM handlers for pins_* GPIO blocks.
 *
 * These blocks operate on raw Arduino pin numbers, not Matrix D/A port
 * shorthands (see _mini.js for those). Constant/mode blocks are compile-
 * time literals that map to PUSH_I8; runtime blocks emit the matching
 * MiniR4VM opcode.
 */
goog.provide('Blockly.BytecodeVM.pins');
goog.require('Blockly.BytecodeVM');

(function () {
    const G = Blockly.BytecodeVM;

    // Mode constants used by PIN_MODE: 0=INPUT, 1=OUTPUT, 2=INPUT_PULLUP.
    const MODE_ID = { INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2 };

    // ---------------------------------------------------------------------
    // Field-only literal blocks: emit a constant push.
    // ---------------------------------------------------------------------
    G['pins_high_low'] = function () {
        const raw = this.getFieldValue('HIGHLOW');
        const v = (String(raw).toUpperCase() === 'HIGH') ? 1 : 0;
        return [G.pushInt(v), G.ORDER_ATOMIC];
    };
    G['mini_pins_high_low'] = G['pins_high_low'];

    G['pins_input_output'] = function () {
        const raw = this.getFieldValue('MODE') || this.getFieldValue('INPUTOUTPUT');
        const v = (raw in MODE_ID) ? MODE_ID[raw] : 0;
        return [G.pushInt(v), G.ORDER_ATOMIC];
    };

    function digitalPinLiteral() {
        const raw = this.getFieldValue('PIN');
        const n = parseInt(raw, 10);
        return [G.pushInt(Number.isFinite(n) ? n : 0), G.ORDER_ATOMIC];
    }
    G['pins_digital'] = digitalPinLiteral;
    G['pins_analog']  = digitalPinLiteral;
    G['pins_pwm']     = digitalPinLiteral;

    // ---------------------------------------------------------------------
    // Runtime GPIO ops.
    // VM stack order matches MiniR4VM.cpp:
    //   PIN_MODE      pops mode, pin       -> push pin, mode
    //   DIGITAL_WRITE pops value, pin      -> push pin, value
    //   DIGITAL_READ  pops pin             -> push pin
    //   ANALOG_WRITE  pops value, pin      -> push pin, value
    //   ANALOG_READ   pops pin             -> push pin
    // ---------------------------------------------------------------------
    G['pins_pin_mode'] = function () {
        const pin  = G.valueToCode(this, 'PIN',  G.ORDER_ATOMIC) || G.pushInt(0);
        const mode = G.valueToCode(this, 'MODE', G.ORDER_ATOMIC) || G.pushInt(0);
        return pin + mode + G.byte(G.OPS.PIN_MODE);
    };

    G['pins_digital_write'] = function () {
        const pin = G.valueToCode(this, 'PIN',   G.ORDER_ATOMIC) || G.pushInt(0);
        const val = G.valueToCode(this, 'VALUE', G.ORDER_ATOMIC)
                 || G.valueToCode(this, 'STATE', G.ORDER_ATOMIC)
                 || G.pushInt(0);
        return pin + val + G.byte(G.OPS.DIGITAL_WRITE);
    };

    G['pins_digital_read'] = function () {
        const pin = G.valueToCode(this, 'PIN', G.ORDER_ATOMIC) || G.pushInt(0);
        return [pin + G.byte(G.OPS.DIGITAL_READ), G.ORDER_ATOMIC];
    };

    G['pins_analog_write'] = function () {
        const pin = G.valueToCode(this, 'PIN',   G.ORDER_ATOMIC) || G.pushInt(0);
        const val = G.valueToCode(this, 'VALUE', G.ORDER_ATOMIC) || G.pushInt(0);
        return pin + val + G.byte(G.OPS.ANALOG_WRITE);
    };

    G['pins_analog_read'] = function () {
        const pin = G.valueToCode(this, 'PIN', G.ORDER_ATOMIC) || G.pushInt(0);
        return [pin + G.byte(G.OPS.ANALOG_READ), G.ORDER_ATOMIC];
    };
})();
