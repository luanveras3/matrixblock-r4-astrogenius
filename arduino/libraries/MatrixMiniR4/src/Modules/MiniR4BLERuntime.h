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
 *   Block 5     -- BLE enable flag (byte at offset 0: 0xFF=on, 0x00=off).
 *   Block 6..7  -- free.
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

    /** @return true while bytecode is executing on the VM. */
    bool isRunningVM() const;

    /** @return current value of the persistent BLE enable flag. */
    bool isBLEEnabled() const { return _bleEnabled; }

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
    void _updateLed(uint8_t state);
    bool _loadFromFlash();
    bool _persistToFlash();
    bool _eraseFlash();
    void _sendAck(uint8_t cmd, uint8_t status);
    void _sendState();
    bool _readEnableFlag();
    void _writeEnableFlag(bool enabled);

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
};

extern MiniR4BLERuntimeClass BLERuntime;

#endif  // MINIR4_BLE_RUNTIME_H
