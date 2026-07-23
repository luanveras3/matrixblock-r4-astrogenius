/**
 * @file MiniR4VM.h
 * @brief Bytecode virtual machine for the MatrixMiniR4 runtime.
 *
 * The VM executes a compact bytecode targeted at Blockly-generated programs.
 * A fixed sketch on the R4 receives bytecode over BLE (or any transport),
 * hands it to loadProgram(), and calls run() to execute. The block editor is
 * responsible for compiling AST to bytecode; the VM never re-flashes firmware.
 *
 * Value model: single int32_t type. Booleans use 0/1. Floats will be added
 * later if needed (extra opcodes, or tagged values).
 *
 * @author AstroGenius Team
 */
#ifndef MINIR4VM_H
#define MINIR4VM_H

#include <Arduino.h>
#include <stdint.h>

/**
 * @brief Bytecode opcodes.
 *
 * Encoding: 1-byte opcode followed by 0..N immediate operand bytes.
 * All multi-byte immediates are little-endian.
 * Jump targets are signed 16-bit relative offsets from the byte AFTER the
 * jump instruction (so JMP 0 is a no-op that just advances past itself).
 */
enum class VMOp : uint8_t {
    // --- Control ---
    NOP           = 0x00,
    HALT          = 0x01,

    // --- Stack literals ---
    PUSH_I8       = 0x02, ///< push int8 sign-extended  [1B imm]
    PUSH_I16      = 0x03, ///< push int16 sign-extended [2B imm]
    PUSH_I32      = 0x04, ///< push int32               [4B imm]
    POP           = 0x05,
    DUP           = 0x06,
    SWAP          = 0x07,

    // --- Variables (16 slots) ---
    LOAD_VAR      = 0x10, ///< push var[slot]           [1B slot]
    STORE_VAR     = 0x11, ///< pop -> var[slot]         [1B slot]

    // --- Arithmetic (a op b, with b on top of stack) ---
    ADD           = 0x20,
    SUB           = 0x21,
    MUL           = 0x22,
    DIV           = 0x23,
    MOD           = 0x24,
    NEG           = 0x25,
    ABS           = 0x26,
    MIN           = 0x27,
    MAX           = 0x28,
    RANDOM        = 0x29, ///< push random in [a, b]

    // --- Comparison (result 0/1) ---
    EQ            = 0x30,
    NEQ           = 0x31,
    LT            = 0x32,
    GT            = 0x33,
    LTE           = 0x34,
    GTE           = 0x35,

    // --- Logical ---
    AND           = 0x40,
    OR            = 0x41,
    NOT           = 0x42,

    // --- Control flow (relative i16) ---
    JMP           = 0x50, ///< pc += offset             [2B i16]
    JMP_IF        = 0x51, ///< pop c; if c != 0 pc += offset
    JMP_IF_NOT    = 0x52,
    CALL          = 0x53, ///< push pc onto call stack, jump abs [2B u16]
    RET           = 0x54,

    // --- Timing ---
    DELAY_MS      = 0x60, ///< pop ms; delay
    MILLIS        = 0x61, ///< push millis() as int32

    // --- Built-in RGB LED (2 LEDs) ---
    LED_COLOR     = 0x70, ///< pop b, g, r, id -> setColor

    // --- Buzzer ---
    BUZZ_TONE     = 0x71, ///< pop ms, freq
    BUZZ_STOP     = 0x72,

    // --- DC motor M1..M4 ---
    MOTOR_POWER   = 0x80, ///< pop pwr, id
    MOTOR_SPEED   = 0x81, ///< pop spd, id
    MOTOR_ROTATE  = 0x82, ///< pop deg, spd, id (blocks until done)
    MOTOR_BRAKE   = 0x83, ///< pop brake(0/1), id
    MOTOR_DEGREES = 0x84, ///< pop id -> push encoder degrees
    MOTOR_RESET   = 0x85, ///< pop id

    // --- Servo RC1..RC4 ---
    SERVO_ANGLE   = 0x90, ///< pop angle, id

    // --- IMU ---
    IMU_EULER     = 0xA0, ///< pop axis(0=roll,1=pitch,2=yaw) -> push value
    IMU_ACCEL     = 0xA1, ///< pop axis(0=x,1=y,2=z) -> push value
    IMU_RESET     = 0xA2,

    // --- Buttons ---
    BTN_PRESSED   = 0xB0, ///< pop id(0=down,1=up) -> push 0/1

    // --- OLED ---
    OLED_CLEAR    = 0xC0,
    OLED_CURSOR   = 0xC1, ///< pop y, x
    OLED_PRINT_I  = 0xC2, ///< pop value; print as int
    OLED_DISPLAY  = 0xC3,

    // --- Generic GPIO -----------------------------------------------------
    // Arduino modes: 0=INPUT, 1=OUTPUT, 2=INPUT_PULLUP (see Arduino.h).
    // ANALOG_WRITE emits PWM 0..255; only PWM-capable pins actually output PWM,
    // others do a digital HIGH/LOW threshold. Matrix D1/D2 (left side of D1/D2)
    // and D3/D4 (right side) are PWM-capable — see MatrixMiniR4.h port map.
    PIN_MODE      = 0xD0, ///< pop mode, pin
    DIGITAL_READ  = 0xD1, ///< pop pin -> push 0/1
    DIGITAL_WRITE = 0xD2, ///< pop value(0/1), pin
    ANALOG_READ   = 0xD3, ///< pop pin -> push 0..1023
    ANALOG_WRITE  = 0xD4, ///< pop value(0..255), pin

    // --- DriveDC (differential drivebase) ---------------------------------
    // The drivebase is a single template instance (MiniR4.DriveDC, ID=1) that
    // ties two DC motors together with sync/gyro/PID control.
    //
    // Mode subop convention for MOVE opcodes:
    //   0 = plain    (open loop: Move / MoveDegs / MoveTime)
    //   1 = sync     (encoder-locked: MoveSync / MoveSyncDegs / MoveSyncTime)
    //   2 = gyro     (yaw-locked:   MoveGyro / MoveGyroDegs / MoveGyroTime)
    //
    // In gyro modes, the "right" operand becomes target_yaw and "left" stays
    // as power. Blockly compiler is responsible for pushing the right thing.
    //
    // PID params are fixed-point ×1000 (kp=0.020 -> push 20). Choice is
    // driven by typical values like 0.002 for LEGO motors — ×100 would lose
    // precision below 0.01.
    //
    // *_DEGS / *_TIME variants run BLOCKING until the drive completes, so
    // the VM step() blocks for the drive duration. This matches typical
    // Blockly semantics ("go forward 1 sec, then next block").
    DDC_BEGIN      = 0xE0, ///< pop rightRev, leftRev, rightId, leftId
    DDC_SETPID     = 0xE1, ///< pop kd, ki, kp, mode(0/1/2)      (×1000 fixed-point)
    DDC_MOVE       = 0xE2, ///< pop right, left, mode
    DDC_MOVE_DEGS  = 0xE3, ///< pop brake, degrees, right, left, mode
    DDC_MOVE_TIME  = 0xE4, ///< pop brake, time_ms, right, left, mode
    DDC_TURN       = 0xE5, ///< pop brake, motorMode(0=single/1=two), target_deg, power
    DDC_BRAKE      = 0xE6, ///< pop brake(0=coast/1=brake)
    DDC_DEGREES    = 0xE7, ///< push drivebase encoder degrees
    DDC_RESET      = 0xE8,

    // --- Round 3 trivials -------------------------------------------------
    US_DISTANCE   = 0xE9, ///< pop echoPin, trigPin -> push cm (or -1 timeout)
    MOTOR_SETREV  = 0xEA, ///< pop dir(0/1), id      (M<id>.setReverse)
    SERVO_SETHW   = 0xEB, ///< pop dir(0/1), id      (RC<id>.setHWDir)
    IMU_GYRO      = 0xEC, ///< pop axis(0=X,1=Y,2=Z) -> push value ×100
    LED_BRIGHT    = 0xED, ///< pop brightness(0..255), id
    PWR_VOLT      = 0xEE, ///< push battery voltage ×100 (12.40V -> 1240)
    MOTOR_SETPPR  = 0xEF, ///< pop maxRPM, ppr, id   (M<id>.setPPR_RPM)
    RANDOM_SEED   = 0xF0, ///< pop seed
    ROUND         = 0xF1, ///< pop v -> push v  (no-op for int; reserved for float)
};

/**
 * @brief Compact bytecode VM for MatrixMiniR4.
 *
 * Not thread-safe. One VM per program.
 */
class MiniR4VM
{
public:
    enum class Result : uint8_t
    {
        OK,                    ///< step succeeded, VM still running
        HALTED,                ///< program hit HALT cleanly
        ERR_STACK_OVERFLOW,
        ERR_STACK_UNDERFLOW,
        ERR_CALL_OVERFLOW,
        ERR_CALL_UNDERFLOW,
        ERR_PC_OUT_OF_BOUNDS,
        ERR_BAD_VAR_SLOT,
        ERR_BAD_OPCODE,
        ERR_DIV_BY_ZERO,
    };

    MiniR4VM();

    /**
     * @brief Attach a bytecode program. Does not copy — caller owns memory.
     */
    void loadProgram(const uint8_t* bytecode, uint16_t length);

    /**
     * @brief Reset PC, stacks, and variables. Program stays loaded.
     */
    void reset();

    /**
     * @brief Execute one instruction.
     * @return OK to continue, HALTED on clean exit, or an error.
     */
    Result step();

    /**
     * @brief Run until HALT or error. Yields to Arduino via yield() each step.
     */
    Result run();

    /**
     * @brief Force-stop the VM without touching PC or stacks. Idempotent.
     * Use when an external signal (BLE stop command, e-stop button) needs to
     * interrupt execution between step() calls.
     */
    void halt() { _running = false; _lastResult = Result::HALTED; }

    bool isRunning() const { return _running; }
    uint16_t pc() const { return _pc; }
    Result lastError() const { return _lastResult; }

    /**
     * @brief Callback invoked between 5 ms slices of DELAY_MS so the host
     * runtime can service its transport during long waits without the VM
     * recursing back into step(). BLE branch sets this to
     * BLERuntime.pollBleOnly; WiFi branch sets it to
     * WiFiRuntime.pollNetworkOnly. Default null = no yield (still safe,
     * just no transport progress during waits).
     */
    using YieldFn = void (*)();
    static void setYieldCallback(YieldFn fn);

    static constexpr uint8_t STACK_SIZE      = 32;
    static constexpr uint8_t VAR_COUNT       = 16;
    static constexpr uint8_t CALL_STACK_SIZE = 8;

private:
    const uint8_t* _program;
    uint16_t       _programLen;
    uint16_t       _pc;
    bool           _running;
    Result         _lastResult;

    int32_t _stack[STACK_SIZE];
    uint8_t _sp;

    int32_t _vars[VAR_COUNT];

    uint16_t _callStack[CALL_STACK_SIZE];
    uint8_t  _csp;

    // --- primitives ---
    bool    push(int32_t v);
    bool    pop(int32_t& v);
    bool    readU8(uint8_t& out);
    bool    readI16(int16_t& out);
    bool    readU16(uint16_t& out);
    bool    readI32(int32_t& out);

    // dispatch helpers (grouped so the switch stays readable)
    Result execArith(VMOp op);
    Result execCompare(VMOp op);
    Result execLogic(VMOp op);
    Result execIO(VMOp op);
};

#endif   // MINIR4VM_H
