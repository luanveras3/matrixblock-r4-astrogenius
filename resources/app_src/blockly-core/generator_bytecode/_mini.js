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

    // "I2C1".."I2C4" -> 1..4. Anything else warns and targets port 1 rather
    // than emitting a wild port number the firmware would silently ignore.
    function i2cPort(field, blockType) {
        const m = /([1-4])/.exec(String(field || ''));
        if (!m) { G.warn(blockType, 'unknown I2C port: ' + field); return 1; }
        return parseInt(m[1], 10);
    }

    // ---------------------------------------------------------------------
    // Round 4 — utilities and I2C sensors.
    // The I2C drivers already live inside MiniR4.I2C1..I2C4, so these cost
    // firmware flash but no static RAM, which is what made them affordable.
    // ---------------------------------------------------------------------

    // map(value, fromLow, fromHigh, toLow, toHigh)
    G['mini_map'] = function () {
        const v  = G.valueToCode(this, 'VAL',  G.ORDER_ATOMIC) || G.pushInt(0);
        const fl = G.valueToCode(this, 'frmL', G.ORDER_ATOMIC) || G.pushInt(0);
        const fh = G.valueToCode(this, 'frmH', G.ORDER_ATOMIC) || G.pushInt(0);
        const tl = G.valueToCode(this, 'toL',  G.ORDER_ATOMIC) || G.pushInt(0);
        const th = G.valueToCode(this, 'toH',  G.ORDER_ATOMIC) || G.pushInt(0);
        // Pushed in the order the opcode pops them in reverse: v, fl, fh, tl, th.
        return [v + fl + fh + tl + th + G.byte(G.OPS.MAP), G.ORDER_ATOMIC];
    };

    // I2C laser distance. begin() is a no-op here: the runtime already
    // constructs the driver, and emitting nothing keeps a "begin" block from
    // being reported as unsupported.
    G['mini_i2c_MXLaserV2_getDistance'] = function () {
        const port = i2cPort(this.getFieldValue('PIN'), 'mini_i2c_MXLaserV2_getDistance');
        return [G.pushInt(port) + G.byte(G.OPS.I2C_LASER), G.ORDER_ATOMIC];
    };

    // I2C colour sensor. COLOR selects the component; anything we do not
    // recognise falls back to the colour ID, which is what most programs use.
    G['mini_i2c_MXcolorV3_getColor'] = function () {
        const port = i2cPort(this.getFieldValue('PIN'), 'mini_i2c_MXcolorV3_getColor');
        const map  = { R: 0, G: 1, B: 2, RED: 0, GREEN: 1, BLUE: 2 };
        const raw  = String(this.getFieldValue('COLOR') || '').toUpperCase();
        const ch   = (map[raw] !== undefined) ? map[raw] : 3;
        return [G.pushInt(port) + G.pushInt(ch) + G.byte(G.OPS.I2C_COLOR), G.ORDER_ATOMIC];
    };

    G['mini_OLED_setTextSize'] = function () {
        const v = G.valueToCode(this, 'SIZE', G.ORDER_ATOMIC) || G.pushInt(1);
        return v + G.byte(G.OPS.OLED_TEXTSIZE);
    };
    G['mini_OLED_setTextColor'] = function () {
        const raw = String(this.getFieldValue('COLOR') || '1');
        const v = /black|0/i.test(raw) ? 0 : 1;
        return G.pushInt(v) + G.byte(G.OPS.OLED_TEXTCOLOR);
    };

    G['mini_randomSeed'] = function () {
        const v = G.valueToCode(this, 'SEED', G.ORDER_ATOMIC) || G.pushInt(0);
        return v + G.byte(G.OPS.RANDOM_SEED);
    };

    // --- Round 4b: the rest of the I2C family --------------------------------
    // One generic I2C_READ opcode serves all of these; the generator's only
    // job is to name the (sensor, function) pair.
    function i2cRead(block, sensor, fn) {
        const port = i2cPort(block.getFieldValue('PIN'), block.type);
        return [G.pushInt(port) + G.pushInt(sensor) + G.pushInt(fn) +
                G.byte(G.OPS.I2C_READ), G.ORDER_ATOMIC];
    }

    // begin() blocks emit a REAL bring-up. An earlier cut made them no-ops on
    // the reasoning that the runtime already constructs the driver — hardware
    // disproved it immediately: every sensor read returned its not-present
    // sentinel until begin() actually ran. Constructing the C++ object is not
    // the same as initialising the device (model-ID check, register writes,
    // continuous mode). The runtime does probe them, but only inside the
    // telemetry path, which is now gated on the dashboard being visible — so
    // a VM program cannot assume it has happened.
    function i2cBegin(block, sensor) {
        const port = i2cPort(block.getFieldValue('PIN'), block.type);
        // Result is pushed by the opcode; discard it, the student's block has
        // no output socket.
        return G.pushInt(port) + G.pushInt(sensor) +
               G.byte(G.OPS.I2C_BEGIN) + G.byte(G.OPS.POP);
    }
    G['mini_i2c_MXLaserV2_begin'] = function () { return i2cBegin(this, 0); };
    G['mini_i2c_MXcolorV3_begin'] = function () { return i2cBegin(this, 1); };
    G['mini_i2c_MXlaser_begin']   = function () { return i2cBegin(this, 2); };
    G['mini_i2c_MXcolor_begin']   = function () { return i2cBegin(this, 3); };
    // No bring-up implemented for these yet; emitting nothing is honest —
    // their read blocks are the ones that would fail, not this.
    // Line tracer needs no bring-up call in the driver.
    G['mini_i2c_mxlinetracer_begin'] = function () { return ''; };

    G['mini_i2c_MXlaser_getDistance'] = function () { return i2cRead(this, 0, 0); };

    G['mini_i2c_MXcolor_getColor'] = function () {
        const map = { R: 0, G: 1, B: 2, RED: 0, GREEN: 1, BLUE: 2, GRAY: 4, GRAYSCALE: 4 };
        const raw = String(this.getFieldValue('COLOR') || '').toUpperCase();
        return i2cRead(this, 1, map[raw] !== undefined ? map[raw] : 3);
    };
    G['mini_i2c_MXcolor_getColorNumber'] = function () { return i2cRead(this, 1, 3); };
    G['mini_MXGrayscale_getGrayscale']   = function () { return i2cRead(this, 1, 4); };

    G['mini_i2c_mxlinetracer_get_number'] = function () { return i2cRead(this, 2, 1); };
    G['mini_i2c_mxlinetracer_get_boolean'] = function () { return i2cRead(this, 2, 2); };
    G['mini_i2c_mxlinetracer_getsensor'] = function () {
        const n = parseInt(String(this.getFieldValue('SENSOR') || '1'), 10) || 1;
        return i2cRead(this, 2, 3 + Math.max(0, Math.min(9, n - 1)));
    };

    // --- Round 4c: MATRIX port sensors --------------------------------------
    // These blocks address a port and a side (D4 Left, A1 Left...), never an
    // Arduino pin, so they need the port-aware opcodes rather than
    // DIGITAL_READ / ANALOG_READ.
    function portNum(field, blockType, letter) {
        const m = new RegExp(letter + '\s*([1-4])', 'i').exec(String(field || ''));
        if (!m) { G.warn(blockType, 'unknown port: ' + field); return 1; }
        return parseInt(m[1], 10);
    }
    // Side follows the Arduino generator for each block: it emits getL() or
    // getR() and we mirror whichever it chose, so the VM reads the same wire.
    function portDigital(block, side) {
        return [G.pushInt(portNum(block.getFieldValue('PIN'), block.type, 'D')) +
                G.pushInt(side) + G.byte(G.OPS.PORT_DREAD), G.ORDER_ATOMIC];
    }
    function portAnalog(block, side) {
        return [G.pushInt(portNum(block.getFieldValue('PIN'), block.type, 'A')) +
                G.pushInt(side) + G.byte(G.OPS.PORT_AREAD), G.ORDER_ATOMIC];
    }

    G['mini_MXPIR_getState']              = function () { return portDigital(this, 0); };
    G['mini_MXMiniatureSwitch_getState']  = function () { return portDigital(this, 0); };
    G['mini_MXPot_getPot']                = function () { return portAnalog(this, 0); };
    G['mini_MXSoilMoisture_getMoisture']  = function () { return portAnalog(this, 0); };
    G['mini_MXWaterLevel_getLevel']       = function () { return portAnalog(this, 0); };
    G['mini_Grove_DIget']                 = function () { return portDigital(this, 0); };
    G['mini_Grove_AIget']                 = function () { return portAnalog(this, 0); };

    // --- Round 4d: timers, digital output, numeric Serial --------------------
    G['mini_Grove_DOset'] = function () {
        const port = portNum(this.getFieldValue('PIN'), this.type, 'D');
        const v = G.valueToCode(this, 'VAL', G.ORDER_ATOMIC) || G.pushInt(0);
        return G.pushInt(port) + G.pushInt(0) + v + G.byte(G.OPS.PORT_DWRITE);
    };

    // The Arduino generator keeps one timer_<id> variable per timer; the VM
    // keeps four slots in the runtime instead, same semantics.
    function timerId(block) {
        const n = parseInt(String(block.getFieldValue('TIMER') || '1'), 10) || 1;
        return Math.max(0, Math.min(3, n - 1));
    }
    G['mini_timer_read']  = function () {
        return [G.pushInt(timerId(this)) + G.byte(G.OPS.TIMER_READ), G.ORDER_ATOMIC];
    };
    G['mini_timer_reset'] = function () {
        return G.pushInt(timerId(this)) + G.byte(G.OPS.TIMER_RESET);
    };

    // Numeric print only. The VM has a single int32 value type, so the text
    // forms of these blocks stay unsupported rather than printing something
    // that merely looks right — a silently wrong number is worse than a
    // skipped block the student is told about.
    function serialNum(block, port, newline) {
        const v = G.valueToCode(block, 'VAL', G.ORDER_ATOMIC);
        if (!v) { G.warn(block.type, 'only numeric values are supported by the VM'); return ''; }
        return v + G.pushInt(port) + G.pushInt(newline) + G.byte(G.OPS.SERIAL_NUM);
    }
    G['mini_Serial_print']    = function () { return serialNum(this, 0, 0); };
    G['mini_Serial_println']  = function () { return serialNum(this, 0, 1); };
    G['mini_Serial1_print']   = function () { return serialNum(this, 1, 0); };
    G['mini_Serial1_println'] = function () { return serialNum(this, 1, 1); };
    // Serial1.begin is a no-op: the VM cannot reconfigure a port the runtime
    // shares, and the default baud is what the blocks assume anyway.
    G['mini_Serial1_begin']   = function () { return ''; };

    // --- Round 4e: DHT, line tracer commands, Serial input -------------------
    // DHT keeps the blocks' own split: the polling statement refreshes a cache
    // in the runtime, the value block reads it. Collapsing them into one live
    // read would be simpler and wrong — a DHT conversion takes a quarter of a
    // second, and a value block inside a loop would stall the program.
    G['mini_MXDHT_Polling'] = function () {
        return G.pushInt(portNum(this.getFieldValue('PIN'), this.type, 'D')) +
               G.byte(G.OPS.DHT_POLL);
    };
    G['mini_MXDHT'] = function () {
        const parm = String(this.getFieldValue('PARM') || '').toLowerCase();
        const isHum = /hum/.test(parm);
        return [G.pushInt(portNum(this.getFieldValue('PIN'), this.type, 'D')) +
                G.pushInt(isHum ? 1 : 0) + G.byte(G.OPS.DHT_GET), G.ORDER_ATOMIC];
    };
    G['mini_DHT11get'] = G['mini_MXDHT'];

    function ltCmd(block, fn, arg) {
        return G.pushInt(i2cPort(block.getFieldValue('PIN'), block.type)) +
               G.pushInt(fn) + arg + G.byte(G.OPS.LT_CMD);
    }
    G['mini_i2c_mxlinetracer_setthreshold'] = function () {
        const v = G.valueToCode(this, 'VAL', G.ORDER_ATOMIC) || G.pushInt(50);
        return ltCmd(this, 0, v);
    };
    G['mini_i2c_mxlinetracer_calibration'] = function () {
        // The block picks start or end; anything else we treat as start.
        const end = /end|fim|stop/i.test(String(this.getFieldValue('MODE') || ''));
        return ltCmd(this, end ? 2 : 1, G.pushInt(0));
    };

    function serialIn(block, port, fn) {
        return [G.pushInt(port) + G.pushInt(fn) + G.byte(G.OPS.SERIAL_IN),
                G.ORDER_ATOMIC];
    }
    G['mini_Serial_available']  = function () { return serialIn(this, 0, 0); };
    G['mini_Serial_read']       = function () { return serialIn(this, 0, 1); };
    G['mini_Serial1_available'] = function () { return serialIn(this, 1, 0); };
    G['mini_Serial1_read']      = function () { return serialIn(this, 1, 1); };

    // --- Round 4f: gesture and HT colour ------------------------------------
    // Both drivers are already members of MiniR4.I2C1..I2C4, so these reuse
    // the generic I2C opcodes and cost no static RAM — which is the only
    // reason they fit at all, with 164 bytes left in the budget.
    G['mini_i2c_MXGesture_begin'] = function () { return i2cBegin(this, 4); };
    G['mini_i2c_HTcolor_begin']   = function () { return i2cBegin(this, 5); };

    G['mini_i2c_MXGesture_getGesture'] = function () { return i2cRead(this, 3, 0); };
    // The "is gesture X?" form compares the reading against the block's own
    // gesture code, so the whole test stays inside the VM.
    G['mini_i2c_MXGesture_getGesture_equals'] = function () {
        const raw = String(this.getFieldValue('GESTURE') || '0');
        const map = { RIGHT:1, LEFT:2, UP:4, DOWN:8, FORWARD:16, BACKWARD:32,
                      CLOCKWISE:64, ANTICLOCKWISE:128 };
        const code = map[raw.toUpperCase()] !== undefined
            ? map[raw.toUpperCase()] : (parseInt(raw, 10) || 0);
        const read = i2cRead(this, 3, 0)[0];
        return [read + G.pushInt(code) + G.byte(G.OPS.EQ), G.ORDER_ATOMIC];
    };

    G['mini_i2c_HTcolor_get'] = function () {
        const map = { R:0, G:1, B:2, RED:0, GREEN:1, BLUE:2 };
        const raw = String(this.getFieldValue('COLOR') || '').toUpperCase();
        return i2cRead(this, 4, map[raw] !== undefined ? map[raw] : 3);
    };
})();
