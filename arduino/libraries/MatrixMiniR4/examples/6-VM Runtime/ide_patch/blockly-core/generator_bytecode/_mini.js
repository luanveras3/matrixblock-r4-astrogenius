'use strict';
/*
 * Blockly.BytecodeVM handlers for the mini_* hardware block category.
 *
 * Mirrors blockly-core/generator/_mini.js on the Arduino side. Each block
 * emits a sequence of tokens that push arguments onto the VM stack in the
 * order MiniR4VM.cpp pops them (rightmost operand pushed last).
 *
 * The MATRIXblock PIN fields carry symbolic names ("M1", "RC2", "RGB1",
 * "BTN_UP", ...). MiniR4VM opcodes take integer IDs, so this file contains
 * the small translation tables that map field values to VM IDs.
 *
 * Blocks that reference peripherals the VM cannot drive today (Grove I2C
 * sensors, HuskyLens, etc.) fall through to Blockly.BytecodeVM.warn so the
 * compile still succeeds; the console lists what was skipped.
 */
goog.provide('Blockly.BytecodeVM._mini');
goog.require('Blockly.BytecodeVM');

(function () {
    const G = Blockly.BytecodeVM;

    // ---------------------------------------------------------------------
    // Field -> ID translation tables.
    //
    // Keep these keyed by the exact string values in blockly-core/arduino.js
    // profile.default so the mapping stays 1:1 with the picker options.
    // Any unrecognised value returns 0 and warns; the compile still
    // completes so students can see the sketch load.
    // ---------------------------------------------------------------------
    const MOTOR_ID  = { M1: 1, M2: 2, M3: 3, M4: 4 };
    const SERVO_ID  = { RC1: 1, RC2: 2, RC3: 3, RC4: 4 };
    const LED_ID    = { RGB1: 1, RGB2: 2, LED1: 1, LED2: 2 };
    const BUTTON_ID = { BTN_UP: 1, BTN_DOWN: 0 };
    const AXIS_ID   = { X: 0, Y: 1, Z: 2, Roll: 0, Pitch: 1, Yaw: 2 };
    const DPIN_ID   = { D1: 0, D2: 1, D3: 2, D4: 3 };
    const APIN_ID   = { A1: 0, A2: 1, A3: 2 };

    function lookupId(table, raw, blockType) {
        if (raw in table) return table[raw];
        // Some blocks set the field to a bare numeric string ("1", "2") that
        // the C++ generator uses verbatim. Accept those too so we don't emit
        // id=0 (which the hardware layer rejects, giving the appearance that
        // the block did nothing).
        const asInt = parseInt(raw, 10);
        if (Number.isFinite(asInt) && asInt >= 0 && asInt <= 255) return asInt;
        G.warn(blockType, 'Unknown port "' + raw + '"; emitting id=0.');
        return 0;
    }

    // Blockly boolean fields are stringified ("true"/"false"); coerce to 0/1.
    function boolToByte(v) { return (String(v).toLowerCase() === 'true') ? 1 : 0; }

    // ---------------------------------------------------------------------
    // LED
    // VM: LED_COLOR pops b, g, r, id  -> push order id, r, g, b
    //     LED_BRIGHT pops brightness, id -> push order id, brightness
    // ---------------------------------------------------------------------
    G['mini_setRGB'] = function () {
        const id = lookupId(LED_ID, this.getFieldValue('PIN'), 'mini_setRGB');
        const r  = G.valueToCode(this, 'R', G.ORDER_ATOMIC) || G.pushInt(0);
        const gv = G.valueToCode(this, 'G', G.ORDER_ATOMIC) || G.pushInt(0);
        const b  = G.valueToCode(this, 'B', G.ORDER_ATOMIC) || G.pushInt(0);
        return G.pushInt(id) + r + gv + b + G.byte(G.OPS.LED_COLOR);
    };

    G['mini_setRGB_Brightness'] = function () {
        const id = lookupId(LED_ID, this.getFieldValue('PIN'), 'mini_setRGB_Brightness');
        const br = G.valueToCode(this, 'Brightness', G.ORDER_ATOMIC) || G.pushInt(0);
        return G.pushInt(id) + br + G.byte(G.OPS.LED_BRIGHT);
    };

    // ---------------------------------------------------------------------
    // Buzzer
    // VM: BUZZ_TONE pops ms, freq -> push order freq, ms
    //     BUZZ_STOP takes no args
    //
    // Note: the Arduino side calls MiniR4.Buzzer.Tone(freq, VOLUME). The VM
    // opcode's second arg is duration in ms, not volume, because the runtime
    // treats "VOL" as a hold time so the buzzer stops on its own without a
    // paired NoTone block. Same convention as the SPIKE-style hub.
    // ---------------------------------------------------------------------
    G['mini_Buzzer_Tone'] = function () {
        const freq = G.valueToCode(this, 'FREQ', G.ORDER_ATOMIC) || G.pushInt(0);
        const ms   = G.valueToCode(this, 'VOL',  G.ORDER_ATOMIC) || G.pushInt(0);
        return freq + ms + G.byte(G.OPS.BUZZ_TONE);
    };

    G['mini_Buzzer_ToneNote'] = function () {
        const freqRaw = this.getFieldValue('FREQ');
        const freq = parseInt(freqRaw, 10);
        const ms   = G.valueToCode(this, 'VOL', G.ORDER_ATOMIC) || G.pushInt(0);
        return G.pushInt(Number.isFinite(freq) ? freq : 0) + ms +
               G.byte(G.OPS.BUZZ_TONE);
    };

    G['mini_Buzzer_NoTone'] = function () {
        return G.byte(G.OPS.BUZZ_STOP);
    };

    // ---------------------------------------------------------------------
    // DC motors M1..M4
    // VM stack orders below match MiniR4VM.cpp comments verbatim.
    // ---------------------------------------------------------------------
    G['mini_Mset'] = G['mini_MsetPower'] = function () {
        const id  = lookupId(MOTOR_ID, this.getFieldValue('PIN'), 'mini_MsetPower');
        const pwr = G.valueToCode(this, 'Speed', G.ORDER_ATOMIC)
                 || G.valueToCode(this, 'Power', G.ORDER_ATOMIC)
                 || G.pushInt(0);
        return G.pushInt(id) + pwr + G.byte(G.OPS.MOTOR_POWER);
    };

    G['mini_MsetSpeed'] = function () {
        const id  = lookupId(MOTOR_ID, this.getFieldValue('PIN'), 'mini_MsetSpeed');
        const spd = G.valueToCode(this, 'Speed', G.ORDER_ATOMIC) || G.pushInt(0);
        return G.pushInt(id) + spd + G.byte(G.OPS.MOTOR_SPEED);
    };

    G['mini_Mrot'] = function () {
        const id   = lookupId(MOTOR_ID, this.getFieldValue('PIN'), 'mini_Mrot');
        const spd  = G.valueToCode(this, 'Speed',  G.ORDER_ATOMIC) || G.pushInt(0);
        const degs = G.valueToCode(this, 'Degree', G.ORDER_ATOMIC) || G.pushInt(0);
        return G.pushInt(id) + spd + degs + G.byte(G.OPS.MOTOR_ROTATE);
    };

    G['mini_Mbrake'] = function () {
        const id    = lookupId(MOTOR_ID, this.getFieldValue('PIN'), 'mini_Mbrake');
        const brake = boolToByte(this.getFieldValue('BrakeType'));
        return G.pushInt(id) + G.pushInt(brake) + G.byte(G.OPS.MOTOR_BRAKE);
    };

    G['mini_MsetDIR'] = function () {
        const id  = lookupId(MOTOR_ID, this.getFieldValue('PIN'), 'mini_MsetDIR');
        const dir = boolToByte(this.getFieldValue('DIR'));
        return G.pushInt(id) + G.pushInt(dir) + G.byte(G.OPS.MOTOR_SETREV);
    };

    G['mini_ENC_reset'] = function () {
        const id = lookupId(MOTOR_ID, this.getFieldValue('PIN'), 'mini_ENC_reset');
        return G.pushInt(id) + G.byte(G.OPS.MOTOR_RESET);
    };

    G['mini_ENC_get'] = function () {
        const id = lookupId(MOTOR_ID, this.getFieldValue('PIN'), 'mini_ENC_get');
        return [G.pushInt(id) + G.byte(G.OPS.MOTOR_DEGREES), G.ORDER_ATOMIC];
    };

    // ---------------------------------------------------------------------
    // Servos RC1..RC4
    // ---------------------------------------------------------------------
    G['mini_RCset'] = function () {
        const id  = lookupId(SERVO_ID, this.getFieldValue('PIN'), 'mini_RCset');
        const ang = G.valueToCode(this, 'Angle', G.ORDER_ATOMIC) || G.pushInt(0);
        return G.pushInt(id) + ang + G.byte(G.OPS.SERVO_ANGLE);
    };

    G['mini_RCsetDIR'] = function () {
        const id  = lookupId(SERVO_ID, this.getFieldValue('PIN'), 'mini_RCsetDIR');
        const dir = boolToByte(this.getFieldValue('DIR'));
        return G.pushInt(id) + G.pushInt(dir) + G.byte(G.OPS.SERVO_SETHW);
    };

    // ---------------------------------------------------------------------
    // Buttons -- boolean value block
    // ---------------------------------------------------------------------
    G['mini_BTNget'] = function () {
        const id = lookupId(BUTTON_ID, this.getFieldValue('PIN'), 'mini_BTNget');
        return [G.pushInt(id) + G.byte(G.OPS.BTN_PRESSED), G.ORDER_ATOMIC];
    };

    // ---------------------------------------------------------------------
    // IMU (Motion)
    // AXIS may end with "_RAW" on accel/gyro; the VM only exposes cooked
    // values today, so we strip the suffix and warn.
    // ---------------------------------------------------------------------
    function emitImuValue(block, opcode, blockType) {
        let axisRaw = block.getFieldValue('AXIS');
        if (typeof axisRaw === 'string' && axisRaw.endsWith('_RAW')) {
            G.warn(blockType, 'RAW axis "' + axisRaw +
                '" not supported by the VM; using cooked value.');
            axisRaw = axisRaw.slice(0, -4);
        }
        const axis = lookupId(AXIS_ID, axisRaw, blockType);
        return [G.pushInt(axis) + G.byte(opcode), G.ORDER_ATOMIC];
    }

    G['mini_motion_getAccel'] = function () {
        return emitImuValue(this, G.OPS.IMU_ACCEL, 'mini_motion_getAccel');
    };
    G['mini_motion_getGyro'] = function () {
        return emitImuValue(this, G.OPS.IMU_GYRO, 'mini_motion_getGyro');
    };
    G['mini_motion_getEuler'] = function () {
        return emitImuValue(this, G.OPS.IMU_EULER, 'mini_motion_getEuler');
    };
    G['mini_motion_reset'] = function () {
        return G.byte(G.OPS.IMU_RESET);
    };

    // ---------------------------------------------------------------------
    // OLED
    // Only integer print + cursor + clear + display are covered today.
    // String print (mini_OLED_print with a text child) warns and skips.
    // ---------------------------------------------------------------------
    G['mini_OLED_clear'] = function () {
        return G.byte(G.OPS.OLED_CLEAR);
    };
    G['mini_OLED_display'] = function () {
        return G.byte(G.OPS.OLED_DISPLAY);
    };
    G['mini_OLED_setCusor'] = function () {
        const x = G.valueToCode(this, 'X', G.ORDER_ATOMIC) || G.pushInt(0);
        const y = G.valueToCode(this, 'Y', G.ORDER_ATOMIC) || G.pushInt(0);
        return x + y + G.byte(G.OPS.OLED_CURSOR);
    };
    G['mini_OLED_print'] = function () {
        const v = G.valueToCode(this, 'STR', G.ORDER_ATOMIC)
               || G.valueToCode(this, 'VALUE', G.ORDER_ATOMIC)
               || G.valueToCode(this, 'TEXT', G.ORDER_ATOMIC);
        if (!v) {
            G.warn('mini_OLED_print',
                'Empty print block skipped (no integer expression connected).');
            return '';
        }
        return v + G.byte(G.OPS.OLED_PRINT_I);
    };
    G['mini_OLED_printEASY'] = function () {
        G.warn('mini_OLED_printEASY',
            'OLED string print needs a string subsystem; not compiled.');
        return '';
    };

    // ---------------------------------------------------------------------
    // Timer / clock
    // ---------------------------------------------------------------------
    G['mini_millis'] = function () {
        return [G.byte(G.OPS.MILLIS), G.ORDER_ATOMIC];
    };

    // ---------------------------------------------------------------------
    // Ultrasonic distance -- port lookup at compile time.
    // The MATRIX Mini R4 wires each digital port D1..D4 to a pair of Arduino
    // pins for HC-SR04 (trigger, echo). Table below matches
    // src/Modules/MMLower.h.
    // ---------------------------------------------------------------------
    const US_PORT_PINS = {
        // D1: {trig:2, echo:3}, D2: {trig:4, echo:5}, ...  Placeholder until
        // pin routing is confirmed with hardware.
    };
    G['mini_USget'] = function () {
        const port = this.getFieldValue('PIN');
        if (!(port in US_PORT_PINS)) {
            G.warn('mini_USget',
                'Ultrasonic port "' + port +
                '" pin routing not yet in the compiler; block skipped.');
            return [G.pushInt(-1), G.ORDER_ATOMIC];
        }
        const pins = US_PORT_PINS[port];
        return [G.pushInt(pins.trig) + G.pushInt(pins.echo) +
                G.byte(G.OPS.US_DISTANCE), G.ORDER_ATOMIC];
    };

    // ---------------------------------------------------------------------
    // Power sensor
    // ---------------------------------------------------------------------
    G['mini_PWR_getVolt'] = function () {
        return [G.byte(G.OPS.PWR_VOLT), G.ORDER_ATOMIC];
    };

    // ---------------------------------------------------------------------
    // Matrix D1..D4 / A1..A3 shorthand pin accessors.
    // These share the digital/analog VM opcodes; the PIN2 sub-field selects
    // the specific line inside the 4-pin port. Actual pin routing lives in
    // the hardware library and cannot be looked up from JS; today we warn
    // and fall through.
    // ---------------------------------------------------------------------
    G['mini_DIget'] = function () {
        G.warn('mini_DIget',
            'Matrix D-port digital read not yet mapped to a VM pin id.');
        return [G.pushInt(0), G.ORDER_ATOMIC];
    };
    G['mini_DOset'] = function () {
        G.warn('mini_DOset',
            'Matrix D-port digital write not yet mapped to a VM pin id.');
        return '';
    };
    G['mini_AIget'] = function () {
        G.warn('mini_AIget',
            'Matrix A-port analog read not yet mapped to a VM pin id.');
        return [G.pushInt(0), G.ORDER_ATOMIC];
    };
})();
