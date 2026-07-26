'use strict';
/*
 * Blockly.BytecodeVM handlers for the MATRIX DriveDC family (differential
 * drivebase). Wires 14 mini_ddc_* Blockly blocks to VM opcodes 0xE0..0xE8
 * (see src/Modules/MiniR4VM.h). All opcodes were already in the VM before
 * this file existed -- previously the blocks fell through to the "no
 * generator" warning at compile time.
 *
 * Push order convention: rightmost operand is popped first by the VM, so
 * we push arguments left-to-right and the opcode picks them up in reverse.
 * "pop b, a, c" in the .h comment means push order is c, a, b (c first,
 * b last / on top).
 *
 * PID params are tricky: MiniR4.DriveDC.set*PID takes floats (kp, ki, kd),
 * but the VM stores them as int32 fixed-point ×1000. Blockly value inputs
 * are integers, so the user is expected to type "3140" for 3.14 -- we do
 * NOT auto-multiply, that would surprise students who typed 3 meaning 3.0.
 * If we later grow a float-friendly compiler pass we can revisit.
 */
goog.provide('Blockly.BytecodeVM.drivedc');
goog.require('Blockly.BytecodeVM');

(function () {
    const G = Blockly.BytecodeVM;

    // MATRIX picker fields are strings like "M1", "M2", "1", "2".
    function motorIdFromField(raw, blockType) {
        if (typeof raw === 'string' && raw.charAt(0).toUpperCase() === 'M') {
            const n = parseInt(raw.substring(1), 10);
            if (Number.isFinite(n) && n >= 1 && n <= 4) return n;
        }
        const asInt = parseInt(raw, 10);
        if (Number.isFinite(asInt) && asInt >= 1 && asInt <= 4) return asInt;
        G.warn(blockType, 'Unknown motor id "' + raw + '"; emitting id=1.');
        return 1;
    }

    // Boolean picker fields arrive as the strings "true" / "false".
    function boolToByte(v) { return (String(v).toLowerCase() === 'true') ? 1 : 0; }

    // Shared: compile the (SPEEDL, SPEEDR) operand pair used by most Move
    // variants. Returns push code with left on the stack below right.
    function speedLR(block) {
        const l = G.valueToCode(block, 'SPEEDL', G.ORDER_ATOMIC) || G.pushInt(0);
        const r = G.valueToCode(block, 'SPEEDR', G.ORDER_ATOMIC) || G.pushInt(0);
        return l + r;
    }

    // -------------------------------------------------------------------
    // Setup / configuration
    // -------------------------------------------------------------------

    // MiniR4.DriveDC.begin(motorL, motorR, revL, revR)
    // Opcode DDC_BEGIN pops: rightRev, leftRev, rightId, leftId
    // Push order: leftId, rightId, leftRev, rightRev.
    G['mini_ddc_setting'] = function () {
        const leftId  = motorIdFromField(this.getFieldValue('PINL'), 'mini_ddc_setting');
        const rightId = motorIdFromField(this.getFieldValue('PINR'), 'mini_ddc_setting');
        const leftRev  = boolToByte(this.getFieldValue('PINL_REV'));
        const rightRev = boolToByte(this.getFieldValue('PINR_REV'));
        // BRAKE_SETTLE field toggles a compile-time #define on the USB path;
        // the VM DriveDC doesn't have an equivalent knob yet, so we ignore
        // it here. Not warning: it's a valid workspace choice, we just
        // don't honour it in bytecode mode.
        return G.pushInt(leftId) + G.pushInt(rightId) +
               G.pushInt(leftRev) + G.pushInt(rightRev) +
               G.byte(G.OPS.DDC_BEGIN);
    };

    // MiniR4.M<n>.setPPR_RPM(ppr, rpm)
    // Opcode MOTOR_SETPPR pops: maxRPM, ppr, id
    // Push order: id, ppr, rpm.
    G['mini_ddc_set_ppr_rpm'] = function () {
        const id  = motorIdFromField(this.getFieldValue('PIN'), 'mini_ddc_set_ppr_rpm');
        const ppr = G.valueToCode(this, 'PPR', G.ORDER_ATOMIC) || G.pushInt(360);
        const rpm = G.valueToCode(this, 'RPM', G.ORDER_ATOMIC) || G.pushInt(200);
        return G.pushInt(id) + ppr + rpm + G.byte(G.OPS.MOTOR_SETPPR);
    };

    // MiniR4.DriveDC.set{MoveSync,MoveGyro,TurnGyro}PID(kp, ki, kd)
    // Opcode DDC_SETPID pops: kd, ki, kp, mode  (mode 0=sync, 1=gyro, 2=turn)
    // Push order: mode, kp, ki, kd.
    const PID_MODE = { MoveSyncPID: 0, MoveGyroPID: 1, TurnGyroPID: 2 };
    G['mini_ddc_set_pid'] = function () {
        const raw  = this.getFieldValue('PID_TYPE');
        const mode = (raw in PID_MODE) ? PID_MODE[raw] : 0;
        if (!(raw in PID_MODE)) {
            G.warn('mini_ddc_set_pid', 'Unknown PID_TYPE "' + raw + '"; using sync.');
        }
        const kp = G.valueToCode(this, 'KP', G.ORDER_ATOMIC) || G.pushInt(0);
        const ki = G.valueToCode(this, 'KI', G.ORDER_ATOMIC) || G.pushInt(0);
        const kd = G.valueToCode(this, 'KD', G.ORDER_ATOMIC) || G.pushInt(0);
        return G.pushInt(mode) + kp + ki + kd + G.byte(G.OPS.DDC_SETPID);
    };

    // -------------------------------------------------------------------
    // Continuous move (no distance/time constraint)
    // DDC_MOVE pops: right, left, mode  (mode 0=plain, 1=sync, 2=gyro)
    // Push order: mode, left, right.
    // -------------------------------------------------------------------
    G['mini_ddc_on'] = function () {
        return G.pushInt(0) + speedLR(this) + G.byte(G.OPS.DDC_MOVE);
    };
    G['mini_ddc_on_sync'] = function () {
        return G.pushInt(1) + speedLR(this) + G.byte(G.OPS.DDC_MOVE);
    };
    // MoveGyro takes (speed, heading). The USB generator hardcodes heading=0
    // (see arduino generator), so we mirror that here: left = speed, right = 0.
    G['mini_ddc_on_gyro'] = function () {
        const speed = G.valueToCode(this, 'SPEEDL', G.ORDER_ATOMIC) || G.pushInt(0);
        return G.pushInt(2) + speed + G.pushInt(0) + G.byte(G.OPS.DDC_MOVE);
    };

    // -------------------------------------------------------------------
    // Bounded move (Blocks for a fixed distance or duration)
    // DDC_MOVE_DEGS pops: brake, degrees, right, left, mode
    // DDC_MOVE_TIME pops: brake, time_ms, right, left, mode
    // Push order for both: mode, left, right, num, brake.
    // The UNIT field ("degrees" vs "time"/other) picks the opcode.
    // -------------------------------------------------------------------
    function emitRunFor(block, mode, leftPush, rightPush) {
        const num       = G.valueToCode(block, 'NUM', G.ORDER_ATOMIC) || G.pushInt(0);
        const brakeType = boolToByte(block.getFieldValue('BrakeType'));
        const unit      = block.getFieldValue('UNIT');
        const opcode    = (unit === 'degrees')
            ? G.OPS.DDC_MOVE_DEGS
            : G.OPS.DDC_MOVE_TIME;
        return G.pushInt(mode) + leftPush + rightPush + num +
               G.pushInt(brakeType) + G.byte(opcode);
    }
    G['mini_ddc_runFor'] = function () {
        const l = G.valueToCode(this, 'SPEEDL', G.ORDER_ATOMIC) || G.pushInt(0);
        const r = G.valueToCode(this, 'SPEEDR', G.ORDER_ATOMIC) || G.pushInt(0);
        return emitRunFor(this, 0, l, r);
    };
    G['mini_ddc_runFor_sync'] = function () {
        const l = G.valueToCode(this, 'SPEEDL', G.ORDER_ATOMIC) || G.pushInt(0);
        const r = G.valueToCode(this, 'SPEEDR', G.ORDER_ATOMIC) || G.pushInt(0);
        return emitRunFor(this, 1, l, r);
    };
    G['mini_ddc_runFor_gyro'] = function () {
        // Gyro variants take a single speed + implicit heading 0, matching
        // the USB generator.
        const speed = G.valueToCode(this, 'SPEED', G.ORDER_ATOMIC) || G.pushInt(0);
        return emitRunFor(this, 2, speed, G.pushInt(0));
    };

    // -------------------------------------------------------------------
    // Point turn (gyro-assisted, target angle)
    // DDC_TURN pops: brake, motorMode, target_deg, power
    // Push order: power, target_deg, motorMode, brake.
    // -------------------------------------------------------------------
    function emitTurn(block, motorMode) {
        const speed     = G.valueToCode(block, 'SPEED', G.ORDER_ATOMIC) || G.pushInt(0);
        const angle     = G.valueToCode(block, 'ANGLE', G.ORDER_ATOMIC) || G.pushInt(0);
        const brakeType = boolToByte(block.getFieldValue('BrakeType'));
        return speed + angle + G.pushInt(motorMode) + G.pushInt(brakeType) +
               G.byte(G.OPS.DDC_TURN);
    }
    G['mini_ddc_turn']    = function () { return emitTurn(this, 0); };
    G['mini_ddc_turntwo'] = function () { return emitTurn(this, 1); };

    // -------------------------------------------------------------------
    // Brake / counter
    // -------------------------------------------------------------------

    // DDC_BRAKE pops: brake(0/1)
    G['mini_ddc_off'] = function () {
        const brakeType = boolToByte(this.getFieldValue('BrakeType'));
        return G.pushInt(brakeType) + G.byte(G.OPS.DDC_BRAKE);
    };

    // DDC_DEGREES pushes the drivebase encoder degrees.
    G['mini_ddc_get_degs'] = function () {
        return [G.byte(G.OPS.DDC_DEGREES), G.ORDER_ATOMIC];
    };

    // DDC_RESET no args.
    G['mini_ddc_reset_degs'] = function () {
        return G.byte(G.OPS.DDC_RESET);
    };
})();
