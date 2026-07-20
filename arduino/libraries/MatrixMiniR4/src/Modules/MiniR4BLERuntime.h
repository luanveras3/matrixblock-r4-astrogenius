/**
 * @file MiniR4BLERuntime.h
 * @brief Always-on BLE bytecode runtime for the Matrix Mini R4.
 *
 * Provides `BLERuntime.begin()` / `BLERuntime.poll()` so any user sketch can
 * turn itself into an over-the-air bytecode target. Once a sketch that calls
 * these two methods is flashed via USB, the R4 stays reachable at BLE name
 * `MATRIX-R4-Runtime` for future uploads -- no more USB round-trips.
 *
 * Modes:
 *  - VM mode:    dataflash has a valid MBR4 program header. Bytecode runs on
 *                MiniR4VM. `isRunningVM()` returns true. The user's loop
 *                function should skip its own body.
 *  - Native mode: dataflash is empty. `isRunningVM()` returns false. The user
 *                loop runs as compiled.
 *
 * BLE is always advertising in both modes so the IDE can push a new program,
 * or erase the stored one, at any time.
 *
 * Runtime kill switch: holding BTN_UP + BTN_DOWN together for 3 seconds
 * toggles a persistent flag in dataflash block 5 that disables BLE entirely.
 * The gesture is checked in `poll()` and only fires while BOTH buttons are
 * held, so `MiniR4.BTN_UP.getState()` / `BTN_DOWN.getState()` in user code
 * still work normally for single-button reads.
 *
 * Dataflash map:
 *   Block 0     -- reserved for the vEEPROM lib (IMU cal @ 50..73). Untouched.
 *   Block 1..4  -- bytecode program storage (4 KB max).
 *   Block 5     -- runtime state:
 *                    offset 0     : BLE enable flag byte (0xFF=on, 0x00=off).
 *                    offset 1..3  : padding (kept 0xFF).
 *                    offset 4..7  : last-known sketch ID (uint32 LE);
 *                                   0xFFFFFFFF = never set.
 *   Block 6     -- custom BLE local name:
 *                    offset 0..3  : magic 'M','B','R','N' if set.
 *                    offset 4     : length (1..MAX_DEVICE_NAME).
 *                    offset 5..N  : printable ASCII bytes (no null terminator).
 *                  Unset (magic missing) means advertise as MATRIX-R4-Runtime.
 *   Block 7     -- free.
 */
#ifndef MINIR4_BLE_RUNTIME_H
#define MINIR4_BLE_RUNTIME_H

#include <Arduino.h>
#include <stdint.h>
#include "MiniR4VM.h"

class MiniR4BLERuntimeClass
{
public:
    MiniR4BLERuntimeClass();

    /**
     * @brief Boot BLE + load stored bytecode if any.
     *
     * Safe to call multiple times; extra calls are no-ops. If the persistent
     * enable flag is 0x00, sets up nothing (except the button-gesture poll
     * so the user can turn BLE back on without reflashing).
     *
     * Must be called AFTER MiniR4.begin() so buttons and LEDs are ready.
     */
    void begin();

    /**
     * @brief Service BLE + advance the VM one batch of steps.
     *
     * Call from the top of `loop()`. Users should NOT call their own logic
     * while `isRunningVM()` is true, so the typical loop body is:
     *
     *     void loop() {
     *         BLERuntime.poll();
     *         if (!BLERuntime.isRunningVM()) { userLoop(); }
     *     }
     */
    void poll();

    /**
     * @brief BLE-safe drop-in replacement for Arduino's global delay().
     *
     * Sleeps for `ms` milliseconds while calling poll() in ~5 ms slices so
     * ATT events stay serviced and pending uploads can be received. The IDE
     * wrapper rewrites every user-visible delay(N) call into
     * BLERuntime.delay(N) so student sketches never starve the BLE stack.
     *
     * Semantics:
     *  - If the BLE stack failed to come up (or was disabled by the kill
     *    switch), degrades to raw delay(ms).
     *  - If a bytecode upload arrives mid-delay and starts the VM, returns
     *    early. The caller's userLoop() then gets skipped by the wrapper.
     */
    void delay(uint32_t ms);

    /**
     * @brief Service ArduinoBLE without advancing the VM.
     *
     * The full poll() drives BLE.poll() *and* steps the VM. That works for
     * the outer loop() but not from inside VM code: the VM's DELAY_MS opcode
     * needs to slice a wait into poll windows without re-entering step(),
     * which would recurse into delay() and blow the stack.
     *
     * No-op when the BLE stack is down.
     */
    void pollBleOnly();

    /**
     * @brief Persist a custom BLE local name (max 24 printable ASCII chars).
     *
     * Overwrites dataflash block 6. Empty or invalid names are rejected.
     * The change takes effect on next reboot -- ArduinoBLE does not support
     * flipping the advertised local name mid-run.
     *
     * Returns true on success. The BLE CMD_SET_NAME (0x08) command exposes
     * this over the wire so the IDE can rename a hub from the classroom.
     */
    bool setDeviceName(const char* name);

    /**
     * @brief Tag the running sketch with a unique per-build ID.
     *
     * Must be called BEFORE begin(). The IDE wrapper injects one call per
     * USB compile with a fresh random uint32. On boot, begin() compares
     * this value against the ID stored in dataflash block 5 offset 4:
     *   - Match  : any previously stored bytecode is still "current" and
     *              auto-runs.
     *   - Differ : a fresh USB upload happened; the stored bytecode is
     *              wiped and the new sketch's userLoop() takes over.
     *
     * If never called (e.g. the standalone MiniR4_BLE_Runtime.ino
     * receiver sketch), the runtime skips the compare entirely and always
     * preserves the stored program. Passing 0xFFFFFFFF has the same
     * "unset" effect.
     */
    void setSketchId(uint32_t id);

    /** @return true while bytecode is executing on the VM. */
    bool isRunningVM() const;

    /** @return current value of the persistent BLE enable flag. */
    bool isBLEEnabled() const { return _bleEnabled; }

    /** @return true if BLE.begin() succeeded and advertise() was called. */
    bool isBLEStackUp() const { return _bleActive; }

    /**
     * @brief Force the enable flag on or off (writes dataflash block 5).
     *
     * Same effect as the 3-second BTN_UP+BTN_DOWN gesture, exposed so
     * advanced sketches can toggle it programmatically.
     */
    void setBLEEnabled(bool enabled);

    // Public only because the ArduinoBLE C callback needs to reach it via
    // the static trampoline. Not part of the intended API.
    void _onRxWriteImpl(const uint8_t* data, int len);

private:
    void _checkToggleGesture();
    void _flashLedFeedback(bool enabling);
    void _updateBleStatusLed();
    bool _loadFromFlash();
    bool _persistToFlash();
    bool _eraseFlash();
    void _sendAck(uint8_t cmd, uint8_t status);
    void _sendState();
    void _sendTelemetry();
    bool _readEnableFlag();
    void _writeEnableFlag(bool enabled);
    uint32_t _readStoredSketchId();
    void _writeBlock5(bool enabled, uint32_t sketchId);
    bool _readDeviceName(char* out, size_t maxLen);
    bool _writeDeviceName(const char* name);

    MiniR4VM _vm;
    uint16_t _programSize;
    uint16_t _receiveExpected;
    uint16_t _receiveOffset;
    bool     _wasRunning;
    bool     _bleActive;      ///< BLE.begin() succeeded
    bool     _bleEnabled;     ///< persistent flag (dataflash block 5)
    bool     _begun;          ///< begin() has been called
    uint8_t  _currentLedState;
    uint32_t _bothButtonsSince;   ///< millis() when both buttons first held; 0 = not held
    bool     _gestureLatched;     ///< prevents double-firing while still holding
    uint32_t _pendingSketchId;    ///< value passed to setSketchId(); 0xFFFFFFFF = unset
};

extern MiniR4BLERuntimeClass BLERuntime;

#endif  // MINIR4_BLE_RUNTIME_H
