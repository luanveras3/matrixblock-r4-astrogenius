/**
 * @file MiniR4VM.cpp
 * @brief Dispatch loop and opcode implementations for MiniR4VM.
 */
#include "MiniR4VM.h"
#include "../MatrixMiniR4.h"
#include "MiniR4BLERuntime.h"

MiniR4VM::MiniR4VM()
    : _program(nullptr), _programLen(0), _pc(0), _running(false),
      _lastResult(Result::OK), _sp(0), _csp(0)
{
    for (uint8_t i = 0; i < VAR_COUNT; ++i) _vars[i] = 0;
}

void MiniR4VM::loadProgram(const uint8_t* bytecode, uint16_t length)
{
    _program    = bytecode;
    _programLen = length;
    reset();
}

void MiniR4VM::reset()
{
    _pc         = 0;
    _sp         = 0;
    _csp        = 0;
    _running    = (_program != nullptr && _programLen > 0);
    _lastResult = Result::OK;
    for (uint8_t i = 0; i < VAR_COUNT; ++i) _vars[i] = 0;
}

// --- primitives ---------------------------------------------------------

bool MiniR4VM::push(int32_t v)
{
    if (_sp >= STACK_SIZE) return false;
    _stack[_sp++] = v;
    return true;
}

bool MiniR4VM::pop(int32_t& v)
{
    if (_sp == 0) return false;
    v = _stack[--_sp];
    return true;
}

bool MiniR4VM::readU8(uint8_t& out)
{
    if (_pc >= _programLen) return false;
    out = _program[_pc++];
    return true;
}

bool MiniR4VM::readI16(int16_t& out)
{
    if (_pc + 2 > _programLen) return false;
    uint16_t lo = _program[_pc++];
    uint16_t hi = _program[_pc++];
    out = (int16_t)(lo | (hi << 8));
    return true;
}

bool MiniR4VM::readU16(uint16_t& out)
{
    if (_pc + 2 > _programLen) return false;
    uint16_t lo = _program[_pc++];
    uint16_t hi = _program[_pc++];
    out = (uint16_t)(lo | (hi << 8));
    return true;
}

bool MiniR4VM::readI32(int32_t& out)
{
    if (_pc + 4 > _programLen) return false;
    uint32_t b0 = _program[_pc++];
    uint32_t b1 = _program[_pc++];
    uint32_t b2 = _program[_pc++];
    uint32_t b3 = _program[_pc++];
    out = (int32_t)(b0 | (b1 << 8) | (b2 << 16) | (b3 << 24));
    return true;
}

// --- grouped opcode handlers -------------------------------------------

MiniR4VM::Result MiniR4VM::execArith(VMOp op)
{
    int32_t b, a;
    if (op == VMOp::NEG || op == VMOp::ABS) {
        if (!pop(a)) return Result::ERR_STACK_UNDERFLOW;
        int32_t r = (op == VMOp::NEG) ? -a : (a < 0 ? -a : a);
        return push(r) ? Result::OK : Result::ERR_STACK_OVERFLOW;
    }
    if (!pop(b) || !pop(a)) return Result::ERR_STACK_UNDERFLOW;

    int32_t r = 0;
    switch (op) {
        case VMOp::ADD:    r = a + b; break;
        case VMOp::SUB:    r = a - b; break;
        case VMOp::MUL:    r = a * b; break;
        case VMOp::DIV:
            if (b == 0) return Result::ERR_DIV_BY_ZERO;
            r = a / b; break;
        case VMOp::MOD:
            if (b == 0) return Result::ERR_DIV_BY_ZERO;
            r = a % b; break;
        case VMOp::MIN:    r = (a < b) ? a : b; break;
        case VMOp::MAX:    r = (a > b) ? a : b; break;
        case VMOp::RANDOM: r = (a == b) ? a : random(a, b); break;
        default:           return Result::ERR_BAD_OPCODE;
    }
    return push(r) ? Result::OK : Result::ERR_STACK_OVERFLOW;
}

MiniR4VM::Result MiniR4VM::execCompare(VMOp op)
{
    int32_t b, a;
    if (!pop(b) || !pop(a)) return Result::ERR_STACK_UNDERFLOW;
    int32_t r = 0;
    switch (op) {
        case VMOp::EQ:  r = (a == b); break;
        case VMOp::NEQ: r = (a != b); break;
        case VMOp::LT:  r = (a <  b); break;
        case VMOp::GT:  r = (a >  b); break;
        case VMOp::LTE: r = (a <= b); break;
        case VMOp::GTE: r = (a >= b); break;
        default:        return Result::ERR_BAD_OPCODE;
    }
    return push(r) ? Result::OK : Result::ERR_STACK_OVERFLOW;
}

MiniR4VM::Result MiniR4VM::execLogic(VMOp op)
{
    if (op == VMOp::NOT) {
        int32_t a;
        if (!pop(a)) return Result::ERR_STACK_UNDERFLOW;
        return push(a ? 0 : 1) ? Result::OK : Result::ERR_STACK_OVERFLOW;
    }
    int32_t b, a;
    if (!pop(b) || !pop(a)) return Result::ERR_STACK_UNDERFLOW;
    int32_t r = (op == VMOp::AND) ? ((a && b) ? 1 : 0)
                                  : ((a || b) ? 1 : 0);
    return push(r) ? Result::OK : Result::ERR_STACK_OVERFLOW;
}

// Dispatch macros: motors and servos are template-instantiated (M1..M4 are
// distinct types), so we can't index them at runtime — switch on the id byte.
#define DISPATCH_MOTOR_1ARG(call, arg) \
    switch (id) { \
        case 1: MiniR4.M1.call(arg); break; \
        case 2: MiniR4.M2.call(arg); break; \
        case 3: MiniR4.M3.call(arg); break; \
        case 4: MiniR4.M4.call(arg); break; \
        default: return Result::OK; \
    }

#define DISPATCH_MOTOR_ROTATE(spd, deg) \
    switch (id) { \
        case 1: MiniR4.M1.rotateFor(spd, deg); break; \
        case 2: MiniR4.M2.rotateFor(spd, deg); break; \
        case 3: MiniR4.M3.rotateFor(spd, deg); break; \
        case 4: MiniR4.M4.rotateFor(spd, deg); break; \
        default: return Result::OK; \
    }

#define DISPATCH_MOTOR_DEGREES(out) \
    switch (id) { \
        case 1: out = MiniR4.M1.getDegrees(); break; \
        case 2: out = MiniR4.M2.getDegrees(); break; \
        case 3: out = MiniR4.M3.getDegrees(); break; \
        case 4: out = MiniR4.M4.getDegrees(); break; \
        default: out = 0; break; \
    }

#define DISPATCH_MOTOR_RESET() \
    switch (id) { \
        case 1: MiniR4.M1.resetCounter(); break; \
        case 2: MiniR4.M2.resetCounter(); break; \
        case 3: MiniR4.M3.resetCounter(); break; \
        case 4: MiniR4.M4.resetCounter(); break; \
        default: return Result::OK; \
    }

#define DISPATCH_SERVO_ANGLE(a) \
    switch (id) { \
        case 1: MiniR4.RC1.setAngle(a); break; \
        case 2: MiniR4.RC2.setAngle(a); break; \
        case 3: MiniR4.RC3.setAngle(a); break; \
        case 4: MiniR4.RC4.setAngle(a); break; \
        default: return Result::OK; \
    }

MiniR4VM::Result MiniR4VM::execIO(VMOp op)
{
    int32_t a, b, c, d;
    switch (op) {
        case VMOp::DELAY_MS: {
            // Slice the wait into ~5 ms chunks and service BLE between them
            // so the ATT link stays responsive during long waits. We cannot
            // call BLERuntime.delay() from here: that method calls poll(),
            // and poll() advances the VM by STEPS_PER_POLL steps -- if any
            // of those steps hits another DELAY_MS we recurse into
            // BLERuntime.delay() -> poll() -> step() and blow the stack.
            // pollBleOnly() drives ArduinoBLE without touching the VM, so
            // no re-entrancy path exists.
            if (!pop(a)) return Result::ERR_STACK_UNDERFLOW;
            if (a <= 0) return Result::OK;
            constexpr uint32_t SLICE_MS = 5;
            const uint32_t start = millis();
            const uint32_t total = (uint32_t)a;
            while ((uint32_t)(millis() - start) < total) {
                if (!_running) return Result::HALTED;   // CMD_STOP or halt()
                BLERuntime.pollBleOnly();
                const uint32_t elapsed = (uint32_t)(millis() - start);
                if (elapsed >= total) break;
                const uint32_t remaining = total - elapsed;
                ::delay(remaining < SLICE_MS ? remaining : SLICE_MS);
            }
            return Result::OK;
        }

        case VMOp::MILLIS:
            return push((int32_t)millis()) ? Result::OK : Result::ERR_STACK_OVERFLOW;

        case VMOp::LED_COLOR: // pop b, g, r, id
            if (!pop(a) || !pop(b) || !pop(c) || !pop(d))
                return Result::ERR_STACK_UNDERFLOW;
            MiniR4.LED.setColor((uint8_t)d, (uint8_t)c, (uint8_t)b, (uint8_t)a);
            return Result::OK;

        case VMOp::BUZZ_TONE: // pop ms, freq
            if (!pop(a) || !pop(b)) return Result::ERR_STACK_UNDERFLOW;
            MiniR4.Buzzer.Tone((uint16_t)b, (uint32_t)a);
            return Result::OK;

        case VMOp::BUZZ_STOP:
            MiniR4.Buzzer.NoTone();
            return Result::OK;

        // --- Motors -----------------------------------------------------
        case VMOp::MOTOR_POWER: { // pop pwr, id
            if (!pop(a) || !pop(b)) return Result::ERR_STACK_UNDERFLOW;
            uint8_t id = (uint8_t)b;
            DISPATCH_MOTOR_1ARG(setPower, (int16_t)a);
            return Result::OK;
        }
        case VMOp::MOTOR_SPEED: { // pop spd, id
            if (!pop(a) || !pop(b)) return Result::ERR_STACK_UNDERFLOW;
            uint8_t id = (uint8_t)b;
            DISPATCH_MOTOR_1ARG(setSpeed, (int16_t)a);
            return Result::OK;
        }
        case VMOp::MOTOR_ROTATE: { // pop deg, spd, id
            if (!pop(a) || !pop(b) || !pop(c)) return Result::ERR_STACK_UNDERFLOW;
            uint8_t id = (uint8_t)c;
            DISPATCH_MOTOR_ROTATE((int16_t)b, (uint16_t)a);
            return Result::OK;
        }
        case VMOp::MOTOR_BRAKE: { // pop brake(0/1), id
            if (!pop(a) || !pop(b)) return Result::ERR_STACK_UNDERFLOW;
            uint8_t id = (uint8_t)b;
            bool brake = (a != 0);
            DISPATCH_MOTOR_1ARG(setBrake, brake);
            return Result::OK;
        }
        case VMOp::MOTOR_DEGREES: { // pop id -> push degrees
            if (!pop(a)) return Result::ERR_STACK_UNDERFLOW;
            uint8_t id = (uint8_t)a;
            int32_t degs = 0;
            DISPATCH_MOTOR_DEGREES(degs);
            return push(degs) ? Result::OK : Result::ERR_STACK_OVERFLOW;
        }
        case VMOp::MOTOR_RESET: { // pop id
            if (!pop(a)) return Result::ERR_STACK_UNDERFLOW;
            uint8_t id = (uint8_t)a;
            DISPATCH_MOTOR_RESET();
            return Result::OK;
        }

        // --- Servo ------------------------------------------------------
        case VMOp::SERVO_ANGLE: { // pop angle, id
            if (!pop(a) || !pop(b)) return Result::ERR_STACK_UNDERFLOW;
            uint8_t id = (uint8_t)b;
            DISPATCH_SERVO_ANGLE((uint16_t)a);
            return Result::OK;
        }

        // --- IMU --------------------------------------------------------
        // Euler is returned in integer degrees; accel is scaled *100 so
        // 1g -> 100 (fits int32 with two decimal places of precision).
        case VMOp::IMU_EULER: { // pop axis -> push value
            if (!pop(a)) return Result::ERR_STACK_UNDERFLOW;
            MiniR4Motion::AxisType ax;
            switch (a) {
                case 0: ax = MiniR4Motion::AxisType::Roll;  break;
                case 1: ax = MiniR4Motion::AxisType::Pitch; break;
                case 2: ax = MiniR4Motion::AxisType::Yaw;   break;
                default: return push(0) ? Result::OK : Result::ERR_STACK_OVERFLOW;
            }
            int32_t v = (int32_t)MiniR4.Motion.getEuler(ax);
            return push(v) ? Result::OK : Result::ERR_STACK_OVERFLOW;
        }
        case VMOp::IMU_ACCEL: { // pop axis -> push value*100
            if (!pop(a)) return Result::ERR_STACK_UNDERFLOW;
            MiniR4Motion::AxisType ax;
            switch (a) {
                case 0: ax = MiniR4Motion::AxisType::X; break;
                case 1: ax = MiniR4Motion::AxisType::Y; break;
                case 2: ax = MiniR4Motion::AxisType::Z; break;
                default: return push(0) ? Result::OK : Result::ERR_STACK_OVERFLOW;
            }
            int32_t v = (int32_t)(MiniR4.Motion.getAccel(ax) * 100.0);
            return push(v) ? Result::OK : Result::ERR_STACK_OVERFLOW;
        }
        case VMOp::IMU_RESET:
            MiniR4.Motion.resetIMUValues();
            return Result::OK;

        // --- Buttons ----------------------------------------------------
        case VMOp::BTN_PRESSED: { // pop id(0=down, 1=up) -> push 0/1
            if (!pop(a)) return Result::ERR_STACK_UNDERFLOW;
            bool pressed = (a == 1) ? MiniR4.BTN_UP.getState()
                                    : MiniR4.BTN_DOWN.getState();
            return push(pressed ? 1 : 0) ? Result::OK : Result::ERR_STACK_OVERFLOW;
        }

        // --- OLED -------------------------------------------------------
        case VMOp::OLED_CLEAR:
            MiniR4.OLED.clearDisplay();
            return Result::OK;

        case VMOp::OLED_CURSOR: // pop y, x
            if (!pop(a) || !pop(b)) return Result::ERR_STACK_UNDERFLOW;
            MiniR4.OLED.setCursor((int16_t)b, (int16_t)a);
            return Result::OK;

        case VMOp::OLED_PRINT_I: // pop value
            if (!pop(a)) return Result::ERR_STACK_UNDERFLOW;
            MiniR4.OLED.print(a);
            return Result::OK;

        case VMOp::OLED_DISPLAY:
            MiniR4.OLED.display();
            return Result::OK;

        // --- Generic GPIO ----------------------------------------------
        case VMOp::PIN_MODE: { // pop mode, pin
            if (!pop(a) || !pop(b)) return Result::ERR_STACK_UNDERFLOW;
            uint8_t modeByte = (uint8_t)a;
            uint8_t mode = (modeByte == 2) ? INPUT_PULLUP
                        : (modeByte == 1) ? OUTPUT
                        :                    INPUT;
            pinMode((uint8_t)b, mode);
            return Result::OK;
        }

        case VMOp::DIGITAL_READ: { // pop pin -> push 0/1
            if (!pop(a)) return Result::ERR_STACK_UNDERFLOW;
            int32_t v = (digitalRead((uint8_t)a) == HIGH) ? 1 : 0;
            return push(v) ? Result::OK : Result::ERR_STACK_OVERFLOW;
        }

        case VMOp::DIGITAL_WRITE: // pop value, pin
            if (!pop(a) || !pop(b)) return Result::ERR_STACK_UNDERFLOW;
            digitalWrite((uint8_t)b, (a != 0) ? HIGH : LOW);
            return Result::OK;

        case VMOp::ANALOG_READ: { // pop pin -> push value
            if (!pop(a)) return Result::ERR_STACK_UNDERFLOW;
            int32_t v = analogRead((uint8_t)a);
            return push(v) ? Result::OK : Result::ERR_STACK_OVERFLOW;
        }

        case VMOp::ANALOG_WRITE: // pop value, pin
            if (!pop(a) || !pop(b)) return Result::ERR_STACK_UNDERFLOW;
            analogWrite((uint8_t)b, (int)a);
            return Result::OK;

        // --- DriveDC (differential drivebase) ---------------------------
        case VMOp::DDC_BEGIN: { // pop rightRev, leftRev, rightId, leftId
            int32_t rr, lr, ri, li;
            if (!pop(rr) || !pop(lr) || !pop(ri) || !pop(li))
                return Result::ERR_STACK_UNDERFLOW;
            MiniR4.DriveDC.begin((uint8_t)li, (uint8_t)ri, lr != 0, rr != 0);
            return Result::OK;
        }

        case VMOp::DDC_SETPID: { // pop kd, ki, kp, mode  (×1000 fixed-point)
            int32_t kd, ki, kp, mode;
            if (!pop(kd) || !pop(ki) || !pop(kp) || !pop(mode))
                return Result::ERR_STACK_UNDERFLOW;
            float fkp = kp / 1000.0f, fki = ki / 1000.0f, fkd = kd / 1000.0f;
            switch (mode) {
                case 0: MiniR4.DriveDC.setMoveSyncPID(fkp, fki, fkd); break;
                case 1: MiniR4.DriveDC.setMoveGyroPID(fkp, fki, fkd); break;
                case 2: MiniR4.DriveDC.setTurnGyroPID(fkp, fki, fkd); break;
                default: break;
            }
            return Result::OK;
        }

        case VMOp::DDC_MOVE: { // pop right, left, mode
            int32_t right, left, mode;
            if (!pop(right) || !pop(left) || !pop(mode))
                return Result::ERR_STACK_UNDERFLOW;
            switch (mode) {
                case 0: MiniR4.DriveDC.Move((int16_t)left, (int16_t)right); break;
                case 1: MiniR4.DriveDC.MoveSync((int16_t)left, (int16_t)right); break;
                case 2: MiniR4.DriveDC.MoveGyro((int16_t)left, (int16_t)right); break; // right=target_yaw
                default: break;
            }
            return Result::OK;
        }

        case VMOp::DDC_MOVE_DEGS: { // pop brake, degrees, right, left, mode  (BLOCKING)
            int32_t brake, degs, right, left, mode;
            if (!pop(brake) || !pop(degs) || !pop(right) || !pop(left) || !pop(mode))
                return Result::ERR_STACK_UNDERFLOW;
            bool br = (brake != 0);
            switch (mode) {
                case 0: MiniR4.DriveDC.MoveDegs((int16_t)left, (int16_t)right, (uint16_t)degs, br); break;
                case 1: MiniR4.DriveDC.MoveSyncDegs((int16_t)left, (int16_t)right, (uint16_t)degs, br); break;
                case 2: MiniR4.DriveDC.MoveGyroDegs((int16_t)left, (int16_t)right, (uint16_t)degs, br); break;
                default: break;
            }
            return Result::OK;
        }

        case VMOp::DDC_MOVE_TIME: { // pop brake, time_ms, right, left, mode  (BLOCKING)
            int32_t brake, ms, right, left, mode;
            if (!pop(brake) || !pop(ms) || !pop(right) || !pop(left) || !pop(mode))
                return Result::ERR_STACK_UNDERFLOW;
            bool  br  = (brake != 0);
            float sec = ms / 1000.0f;   // MiniR4 API takes seconds
            switch (mode) {
                case 0: MiniR4.DriveDC.MoveTime((int16_t)left, (int16_t)right, sec, br); break;
                case 1: MiniR4.DriveDC.MoveSyncTime((int16_t)left, (int16_t)right, sec, br); break;
                case 2: MiniR4.DriveDC.MoveGyroTime((int16_t)left, (int16_t)right, sec, br); break;
                default: break;
            }
            return Result::OK;
        }

        case VMOp::DDC_TURN: { // pop brake, motorMode, target_deg, power
            int32_t brake, mMode, tgt, pwr;
            if (!pop(brake) || !pop(mMode) || !pop(tgt) || !pop(pwr))
                return Result::ERR_STACK_UNDERFLOW;
            MiniR4.DriveDC.TurnGyro((int16_t)pwr, (int16_t)tgt, (uint8_t)mMode, brake != 0);
            return Result::OK;
        }

        case VMOp::DDC_BRAKE: // pop brake type
            if (!pop(a)) return Result::ERR_STACK_UNDERFLOW;
            MiniR4.DriveDC.brake(a != 0);
            return Result::OK;

        case VMOp::DDC_DEGREES: { // push drivebase degrees
            int32_t v = MiniR4.DriveDC.getDegrees();
            return push(v) ? Result::OK : Result::ERR_STACK_OVERFLOW;
        }

        case VMOp::DDC_RESET:
            MiniR4.DriveDC.resetCounter();
            return Result::OK;

        // --- Round 3 trivials --------------------------------------------
        case VMOp::US_DISTANCE: { // pop echoPin, trigPin -> push cm (or -1)
            if (!pop(a) || !pop(b)) return Result::ERR_STACK_UNDERFLOW;
            uint8_t trig = (uint8_t)b, echo = (uint8_t)a;
            pinMode(trig, OUTPUT);
            pinMode(echo, INPUT);
            digitalWrite(trig, LOW);  delayMicroseconds(2);
            digitalWrite(trig, HIGH); delayMicroseconds(10);
            digitalWrite(trig, LOW);
            unsigned long dur = pulseIn(echo, HIGH, 26500); // ~450cm timeout
            int32_t cm;
            if (dur == 0)              cm = -1;
            else if (dur < 294)        cm = 5;             // matches HC04 lib clamp
            else                       cm = (int32_t)(0.017f * (float)dur);
            return push(cm) ? Result::OK : Result::ERR_STACK_OVERFLOW;
        }

        case VMOp::MOTOR_SETREV: { // pop dir, id
            if (!pop(a) || !pop(b)) return Result::ERR_STACK_UNDERFLOW;
            uint8_t id = (uint8_t)b;
            bool    d  = (a != 0);
            switch (id) {
                case 1: MiniR4.M1.setReverse(d); break;
                case 2: MiniR4.M2.setReverse(d); break;
                case 3: MiniR4.M3.setReverse(d); break;
                case 4: MiniR4.M4.setReverse(d); break;
                default: break;
            }
            return Result::OK;
        }

        case VMOp::SERVO_SETHW: { // pop dir, id
            if (!pop(a) || !pop(b)) return Result::ERR_STACK_UNDERFLOW;
            uint8_t id = (uint8_t)b;
            bool    d  = (a != 0);
            switch (id) {
                case 1: MiniR4.RC1.setHWDir(d); break;
                case 2: MiniR4.RC2.setHWDir(d); break;
                case 3: MiniR4.RC3.setHWDir(d); break;
                case 4: MiniR4.RC4.setHWDir(d); break;
                default: break;
            }
            return Result::OK;
        }

        case VMOp::IMU_GYRO: { // pop axis -> push value×100
            if (!pop(a)) return Result::ERR_STACK_UNDERFLOW;
            MiniR4Motion::AxisType ax;
            switch (a) {
                case 0: ax = MiniR4Motion::AxisType::X; break;
                case 1: ax = MiniR4Motion::AxisType::Y; break;
                case 2: ax = MiniR4Motion::AxisType::Z; break;
                default: return push(0) ? Result::OK : Result::ERR_STACK_OVERFLOW;
            }
            int32_t v = (int32_t)(MiniR4.Motion.getGyro(ax) * 100.0);
            return push(v) ? Result::OK : Result::ERR_STACK_OVERFLOW;
        }

        case VMOp::LED_BRIGHT: { // pop brightness, id
            if (!pop(a) || !pop(b)) return Result::ERR_STACK_UNDERFLOW;
            MiniR4.LED.setBrightness((uint8_t)b, (uint8_t)a);
            return Result::OK;
        }

        case VMOp::PWR_VOLT: { // push voltage×100
            int32_t v = (int32_t)(MiniR4.PWR.getBattVoltage() * 100.0f);
            return push(v) ? Result::OK : Result::ERR_STACK_OVERFLOW;
        }

        case VMOp::MOTOR_SETPPR: { // pop maxRPM, ppr, id
            int32_t maxRPM, ppr, id;
            if (!pop(maxRPM) || !pop(ppr) || !pop(id))
                return Result::ERR_STACK_UNDERFLOW;
            switch ((uint8_t)id) {
                case 1: MiniR4.M1.setPPR_RPM((uint16_t)ppr, (uint16_t)maxRPM); break;
                case 2: MiniR4.M2.setPPR_RPM((uint16_t)ppr, (uint16_t)maxRPM); break;
                case 3: MiniR4.M3.setPPR_RPM((uint16_t)ppr, (uint16_t)maxRPM); break;
                case 4: MiniR4.M4.setPPR_RPM((uint16_t)ppr, (uint16_t)maxRPM); break;
                default: break;
            }
            return Result::OK;
        }

        case VMOp::RANDOM_SEED: // pop seed
            if (!pop(a)) return Result::ERR_STACK_UNDERFLOW;
            randomSeed((unsigned long)a);
            return Result::OK;

        case VMOp::ROUND: // no-op for int; here to keep bytecode stable when floats arrive
            return Result::OK;

        default:
            return Result::ERR_BAD_OPCODE;
    }
    (void)c; (void)d; // silence unused warnings on paths that don't need them
}

// --- main dispatch ------------------------------------------------------

MiniR4VM::Result MiniR4VM::step()
{
    if (!_running) return _lastResult;
    if (_pc >= _programLen) {
        _running    = false;
        _lastResult = Result::ERR_PC_OUT_OF_BOUNDS;
        return _lastResult;
    }

    uint8_t raw = _program[_pc++];
    VMOp    op  = static_cast<VMOp>(raw);
    Result  r   = Result::OK;

    switch (op) {
        case VMOp::NOP:  break;
        case VMOp::HALT: _running = false; _lastResult = Result::HALTED; return _lastResult;

        case VMOp::PUSH_I8: {
            uint8_t v;
            if (!readU8(v)) { r = Result::ERR_PC_OUT_OF_BOUNDS; break; }
            if (!push((int32_t)(int8_t)v)) r = Result::ERR_STACK_OVERFLOW;
            break;
        }
        case VMOp::PUSH_I16: {
            int16_t v;
            if (!readI16(v)) { r = Result::ERR_PC_OUT_OF_BOUNDS; break; }
            if (!push((int32_t)v)) r = Result::ERR_STACK_OVERFLOW;
            break;
        }
        case VMOp::PUSH_I32: {
            int32_t v;
            if (!readI32(v)) { r = Result::ERR_PC_OUT_OF_BOUNDS; break; }
            if (!push(v)) r = Result::ERR_STACK_OVERFLOW;
            break;
        }
        case VMOp::POP: {
            int32_t v;
            if (!pop(v)) r = Result::ERR_STACK_UNDERFLOW;
            break;
        }
        case VMOp::DUP: {
            if (_sp == 0)          { r = Result::ERR_STACK_UNDERFLOW; break; }
            if (_sp >= STACK_SIZE) { r = Result::ERR_STACK_OVERFLOW;  break; }
            _stack[_sp] = _stack[_sp - 1]; ++_sp;
            break;
        }
        case VMOp::SWAP: {
            if (_sp < 2) { r = Result::ERR_STACK_UNDERFLOW; break; }
            int32_t t = _stack[_sp - 1];
            _stack[_sp - 1] = _stack[_sp - 2];
            _stack[_sp - 2] = t;
            break;
        }

        case VMOp::LOAD_VAR: {
            uint8_t slot;
            if (!readU8(slot))     { r = Result::ERR_PC_OUT_OF_BOUNDS; break; }
            if (slot >= VAR_COUNT) { r = Result::ERR_BAD_VAR_SLOT;     break; }
            if (!push(_vars[slot])) r = Result::ERR_STACK_OVERFLOW;
            break;
        }
        case VMOp::STORE_VAR: {
            uint8_t slot;
            int32_t v;
            if (!readU8(slot))     { r = Result::ERR_PC_OUT_OF_BOUNDS; break; }
            if (slot >= VAR_COUNT) { r = Result::ERR_BAD_VAR_SLOT;     break; }
            if (!pop(v))            { r = Result::ERR_STACK_UNDERFLOW; break; }
            _vars[slot] = v;
            break;
        }

        case VMOp::ADD: case VMOp::SUB: case VMOp::MUL: case VMOp::DIV:
        case VMOp::MOD: case VMOp::NEG: case VMOp::ABS: case VMOp::MIN:
        case VMOp::MAX: case VMOp::RANDOM:
            r = execArith(op); break;

        case VMOp::EQ:  case VMOp::NEQ: case VMOp::LT:
        case VMOp::GT:  case VMOp::LTE: case VMOp::GTE:
            r = execCompare(op); break;

        case VMOp::AND: case VMOp::OR: case VMOp::NOT:
            r = execLogic(op); break;

        case VMOp::JMP: {
            int16_t off;
            if (!readI16(off)) { r = Result::ERR_PC_OUT_OF_BOUNDS; break; }
            int32_t target = (int32_t)_pc + off;
            if (target < 0 || target > _programLen) { r = Result::ERR_PC_OUT_OF_BOUNDS; break; }
            _pc = (uint16_t)target;
            break;
        }
        case VMOp::JMP_IF:
        case VMOp::JMP_IF_NOT: {
            int16_t off;
            int32_t c;
            if (!readI16(off)) { r = Result::ERR_PC_OUT_OF_BOUNDS;   break; }
            if (!pop(c))       { r = Result::ERR_STACK_UNDERFLOW;   break; }
            bool cond = (op == VMOp::JMP_IF) ? (c != 0) : (c == 0);
            if (cond) {
                int32_t target = (int32_t)_pc + off;
                if (target < 0 || target > _programLen) { r = Result::ERR_PC_OUT_OF_BOUNDS; break; }
                _pc = (uint16_t)target;
            }
            break;
        }
        case VMOp::CALL: {
            uint16_t target;
            if (!readU16(target))          { r = Result::ERR_PC_OUT_OF_BOUNDS; break; }
            if (_csp >= CALL_STACK_SIZE)   { r = Result::ERR_CALL_OVERFLOW;    break; }
            if (target > _programLen)      { r = Result::ERR_PC_OUT_OF_BOUNDS; break; }
            _callStack[_csp++] = _pc;
            _pc = target;
            break;
        }
        case VMOp::RET: {
            if (_csp == 0) { r = Result::ERR_CALL_UNDERFLOW; break; }
            _pc = _callStack[--_csp];
            break;
        }

        // Everything else is I/O.
        default:
            r = execIO(op);
            break;
    }

    if (r != Result::OK) {
        _running    = false;
        _lastResult = r;
    }
    return r;
}

MiniR4VM::Result MiniR4VM::run()
{
    while (_running) {
        Result r = step();
        if (r != Result::OK) return r;
        yield();
    }
    return _lastResult;
}
