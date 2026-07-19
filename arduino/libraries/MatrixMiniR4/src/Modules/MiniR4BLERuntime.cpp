/**
 * @file MiniR4BLERuntime.cpp
 * @brief Implementation of the always-on BLE bytecode runtime.
 *
 * Historical note: this code is a refactor of the standalone
 * examples/6-VM Runtime/MiniR4_BLE_Runtime/MiniR4_BLE_Runtime.ino sketch,
 * repackaged as a library so it can be composed with any user sketch.
 * Protocol, LED indicator, and dataflash layout are unchanged.
 */
#include "MiniR4BLERuntime.h"

#include "MatrixMiniR4.h"
#include "DataFlashBlockDevice.h"
#include <ArduinoBLE.h>

// Optional diagnostic traces. Define MINIR4_BLE_RUNTIME_DEBUG in the sketch
// (before including MatrixMiniR4.h) to get Serial checkpoints inside begin().
#ifdef MINIR4_BLE_RUNTIME_DEBUG
  #define BLERT_TRACE(x) do { Serial.print(F("[BLERT] ")); Serial.println(F(x)); } while (0)
#else
  #define BLERT_TRACE(x) do {} while (0)
#endif

// --- Sizing constants (must match the runtime protocol on the client side) --
namespace {

constexpr uint16_t MAX_PROGRAM     = 4096;
constexpr uint16_t HEADER_SIZE     = 8;
constexpr uint32_t DATAFLASH_BLOCK = 1024;
constexpr uint32_t DATAFLASH_BASE  = 1024;                      // start of block 1
constexpr uint32_t ENABLE_FLAG_ADDR = DATAFLASH_BASE + 4 * DATAFLASH_BLOCK; // block 5
constexpr uint32_t SKETCH_ID_ADDR   = ENABLE_FLAG_ADDR + 4;                 // block 5 offset 4
constexpr uint32_t SKETCH_ID_UNSET  = 0xFFFFFFFFu;
constexpr uint32_t DEVICE_NAME_ADDR = DATAFLASH_BASE + 5 * DATAFLASH_BLOCK; // block 6
constexpr uint8_t  DEVICE_NAME_MAGIC[4] = {'M', 'B', 'R', 'N'};
constexpr uint8_t  MAX_DEVICE_NAME  = 24;                                   // fits under 31-byte ADV budget
constexpr uint8_t  NAME_HEADER_SIZE = 5;                                    // 4 magic + 1 length
constexpr const char* DEFAULT_NAME  = "MATRIX-R4-Runtime";
constexpr uint8_t  MAGIC[4]        = {'M', 'B', 'R', '4'};
constexpr uint8_t  STEPS_PER_POLL  = 32;
constexpr uint32_t TOGGLE_HOLD_MS  = 3000;

enum : uint8_t {
    CMD_START = 0x01, CMD_CHUNK = 0x02, CMD_END   = 0x03,
    CMD_RUN   = 0x04, CMD_STOP  = 0x05, CMD_ERASE = 0x06,
    CMD_INFO  = 0x07, CMD_SET_NAME = 0x08,
    RSP_ACK   = 0xA0, RSP_STATE = 0xA1,
};

// storageBuf holds both the on-flash header and the program payload. Keeping
// them contiguous lets us persist in a single program() call. alignas(4) is
// required by the RA4M1 data flash controller.
alignas(4) uint8_t g_storageBuf[HEADER_SIZE + MAX_PROGRAM];
uint8_t* const g_programBuf = g_storageBuf + HEADER_SIZE;

// ArduinoBLE service/characteristic objects. File-scope so their lifetime
// matches the BLE stack (they are added to the stack once in begin()).
BLEService        g_uartService("6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
BLECharacteristic g_rxChar     ("6E400002-B5A3-F393-E0A9-E50E24DCCA9E", BLEWrite, 128);
BLECharacteristic g_txChar     ("6E400003-B5A3-F393-E0A9-E50E24DCCA9E", BLERead | BLENotify, 32);

DataFlashBlockDevice& g_flash = DataFlashBlockDevice::getInstance();

MiniR4BLERuntimeClass* g_instance = nullptr;   // for the BLE C callback

inline uint32_t roundUp4(uint32_t v) { return (v + 3u) & ~3u; }

}  // namespace

// --- The singleton instance -------------------------------------------------

MiniR4BLERuntimeClass BLERuntime;

// --- Construction -----------------------------------------------------------

MiniR4BLERuntimeClass::MiniR4BLERuntimeClass()
    : _programSize(0)
    , _receiveExpected(0)
    , _receiveOffset(0)
    , _wasRunning(false)
    , _bleActive(false)
    , _bleEnabled(true)     // default; begin() reads real value from flash
    , _begun(false)
    , _currentLedState(0xFF)
    , _bothButtonsSince(0)
    , _gestureLatched(false)
    , _pendingSketchId(SKETCH_ID_UNSET)
{
    g_instance = this;
}

bool MiniR4BLERuntimeClass::isRunningVM() const
{
    return _vm.isRunning();
}

// --- Public API -------------------------------------------------------------

void MiniR4BLERuntimeClass::begin()
{
    if (_begun) { BLERT_TRACE("begin() re-entry ignored"); return; }
    _begun = true;
    BLERT_TRACE("begin() entered");

    _bleEnabled = _readEnableFlag();
#ifdef MINIR4_BLE_RUNTIME_DEBUG
    Serial.print(F("[BLERT] enable flag: "));
    Serial.println(_bleEnabled ? F("YES") : F("NO"));
#endif

    // USB-reflash detection. The IDE wrapper injects a per-build random ID
    // via setSketchId() before begin(). If the running sketch's ID differs
    // from what's stored in dataflash, a fresh USB upload happened and any
    // previously stored BLE bytecode is stale -- wipe it so userLoop() wins.
    // If setSketchId() was never called, skip the check entirely (used by
    // the standalone receiver-only sketch).
    const uint32_t storedSketchId = _readStoredSketchId();
    const bool sketchIdChanged =
        (_pendingSketchId != SKETCH_ID_UNSET) &&
        (_pendingSketchId != storedSketchId);
    if (sketchIdChanged) {
        BLERT_TRACE("sketch id changed -- wiping stored program");
        (void)_eraseFlash();
        _writeBlock5(_bleEnabled, _pendingSketchId);
    }

    if (_loadFromFlash() && _programSize > 0) {
        _vm.loadProgram(g_programBuf, _programSize);
        // Auto-run: whatever is in dataflash is the "current program" and
        // takes over from userLoop(). The wrapper's loop() will skip
        // userLoop() while isRunningVM() stays true.
        BLERT_TRACE("loaded stored program from dataflash");
    } else {
        BLERT_TRACE("no stored program");
    }

    if (!_bleEnabled) {
        BLERT_TRACE("BLE disabled by flag -- not initialising BLE stack");
        return;
    }

    BLERT_TRACE("calling BLE.begin()");
    if (!BLE.begin()) {
        BLERT_TRACE("*** BLE.begin() returned FALSE -- BLE stack init failed ***");
        return;
    }
    BLERT_TRACE("BLE.begin() OK, configuring service");

    // Chromium's Web Bluetooth on Windows drops connections that come up with
    // a very short interval (the ArduinoBLE default is 20 ms which the OS
    // then negotiates down further). Ask for 30..60 ms which pairs stay in
    // for long enough to complete service discovery. Values are in 1.25 ms
    // units per the BLE spec.
    BLE.setConnectionInterval(0x0018, 0x0030);   // 30 ms .. 60 ms
    BLE.setSupervisionTimeout(0x00C8);           // 2000 ms

    g_uartService.addCharacteristic(g_rxChar);
    g_uartService.addCharacteristic(g_txChar);
    BLE.addService(g_uartService);
    g_rxChar.setEventHandler(BLEWritten,
        [](BLEDevice, BLECharacteristic ch) {
            if (g_instance) {
                g_instance->_onRxWriteImpl(ch.value(), ch.valueLength());
            }
        });

    // Split the advertising payload: local name goes in the ADV packet, the
    // 128-bit service UUID goes in the scan response. Together they'd exceed
    // the 31-byte ADV limit and the name would be truncated or dropped, which
    // is exactly what a central scanner sees as "device not visible".
    // Local name is read from dataflash block 6; falls back to
    // MATRIX-R4-Runtime if nobody ever called setDeviceName().
    static char nameBuf[MAX_DEVICE_NAME + 1];
    if (!_readDeviceName(nameBuf, sizeof(nameBuf))) {
        strncpy(nameBuf, DEFAULT_NAME, sizeof(nameBuf) - 1);
        nameBuf[sizeof(nameBuf) - 1] = '\0';
    }
    static BLEAdvertisingData advData;
    static BLEAdvertisingData scanResp;
    advData.setLocalName(nameBuf);
    scanResp.setAdvertisedService(g_uartService);
    BLE.setAdvertisingData(advData);
    BLE.setScanResponseData(scanResp);

    BLE.advertise();
    _bleActive = true;
    BLERT_TRACE("advertise() called");
}

void MiniR4BLERuntimeClass::poll()
{
    _checkToggleGesture();

    if (_bleActive) BLE.poll();

    const bool nowRunning = _vm.isRunning();
    if (nowRunning) {
        for (uint8_t i = 0; i < STEPS_PER_POLL && _vm.isRunning(); ++i) _vm.step();
    } else if (_wasRunning && _bleActive) {
        _sendState();
    }
    _wasRunning = nowRunning;

    // LED2 is reserved for the BLE status indicator so LED1 stays fully
    // controllable by user code / VM bytecode. Colour choices below.
    _updateBleStatusLed();
}

void MiniR4BLERuntimeClass::setSketchId(uint32_t id)
{
    _pendingSketchId = id;
}

bool MiniR4BLERuntimeClass::setDeviceName(const char* name)
{
    return _writeDeviceName(name);
}

void MiniR4BLERuntimeClass::pollBleOnly()
{
    if (_bleActive) BLE.poll();
}

void MiniR4BLERuntimeClass::delay(uint32_t ms)
{
    // BLE not up (kill switch, or begin() never called): behave like
    // Arduino's global delay(). Explicit ::delay() reaches the free function
    // even though this method shares its name.
    if (!_bleActive) { ::delay(ms); return; }

    constexpr uint32_t SLICE_MS = 5;
    const uint32_t start = millis();
    while ((uint32_t)(millis() - start) < ms) {
        poll();
        // A BLE upload that arrived during this delay may have started the
        // VM. The wrapper's top-level loop() skips userLoop() while the VM
        // runs, so returning early here lets that skip take effect on the
        // very next tick instead of after the full ms.
        if (_vm.isRunning()) return;
        const uint32_t elapsed  = (uint32_t)(millis() - start);
        if (elapsed >= ms) return;
        const uint32_t remaining = ms - elapsed;
        ::delay(remaining < SLICE_MS ? remaining : SLICE_MS);
    }
}

void MiniR4BLERuntimeClass::setBLEEnabled(bool enabled)
{
    if (enabled == _bleEnabled) return;
    _writeEnableFlag(enabled);
    _bleEnabled = enabled;
    _flashLedFeedback(enabled);
    // The BLE stack state cannot be flipped mid-run without a restart. We
    // set the flag now; the change takes effect on next boot.
}

// --- Button-gesture toggle --------------------------------------------------

void MiniR4BLERuntimeClass::_checkToggleGesture()
{
    const bool upHeld   = MiniR4.BTN_UP.getState();
    const bool downHeld = MiniR4.BTN_DOWN.getState();
    const bool both     = upHeld && downHeld;
    const uint32_t now  = millis();

    if (!both) {
        _bothButtonsSince = 0;
        _gestureLatched   = false;
        return;
    }
    if (_bothButtonsSince == 0) {
        _bothButtonsSince = now;
        return;
    }
    if (_gestureLatched) return;
    if (now - _bothButtonsSince < TOGGLE_HOLD_MS) return;

    // 3 seconds elapsed with both held -- toggle.
    _gestureLatched = true;
    setBLEEnabled(!_bleEnabled);
}

void MiniR4BLERuntimeClass::_flashLedFeedback(bool enabling)
{
    // Kill-switch gesture feedback lives on LED2 (the BLE indicator LED)
    // so it never fights with user code / VM code that owns LED1.
    const uint8_t r = enabling ? 0   : 60;
    const uint8_t g = enabling ? 60  : 0;
    const uint8_t b = 0;
    for (uint8_t i = 0; i < 3; ++i) {
        MiniR4.LED.setColor(2, r, g, b);
        delay(120);
        MiniR4.LED.setColor(2, 0, 0, 0);
        delay(120);
    }
    _currentLedState = 0xFF;  // force re-apply on next poll()
}

// --- BLE status LED (LED2) --------------------------------------------------
// 0 = off (BLE disabled by kill switch or begin() not called).
// 1 = dim green (BLE up, advertising, no central).
// 2 = cyan (a central is connected -- IDE, nRF Connect, etc).

void MiniR4BLERuntimeClass::_updateBleStatusLed()
{
    // ArduinoBLE's BLE.central() returns a BLEDevice object that stays
    // "truthy" (operator bool = valid handle) even after the central has
    // dropped the link. Only .connected() reflects the live GATT state --
    // otherwise a failed handshake latches LED2 to cyan forever.
    uint8_t state;
    if (!_bleActive) {
        state = 0;
    } else {
        BLEDevice c = BLE.central();
        state = (c && c.connected()) ? 2 : 1;
    }

    if (state == _currentLedState) return;
    _currentLedState = state;
    switch (state) {
        case 0: MiniR4.LED.setColor(2,  0,  0,  0); break;
        case 1: MiniR4.LED.setColor(2,  0, 30,  0); break;
        case 2: MiniR4.LED.setColor(2,  0, 40, 40); break;
    }
}

// --- Dataflash persistence --------------------------------------------------
// Uses raw DataFlashBlockDevice (bypasses vEEPROM wear-leveling). Erases
// whole blocks and programs header+payload in one shot. The driver has a
// bug where multi-block erases only erase the first block, so we erase
// block-by-block explicitly.

bool MiniR4BLERuntimeClass::_loadFromFlash()
{
    uint8_t header[HEADER_SIZE];
    if (g_flash.read(header, DATAFLASH_BASE, HEADER_SIZE) != 0) return false;
    for (uint8_t i = 0; i < 4; ++i) {
        if (header[i] != MAGIC[i]) return false;
    }
    uint32_t sz = (uint32_t)header[4]
                | ((uint32_t)header[5] << 8)
                | ((uint32_t)header[6] << 16)
                | ((uint32_t)header[7] << 24);
    if (sz == 0 || sz > MAX_PROGRAM) return false;

    memcpy(g_storageBuf, header, HEADER_SIZE);
    if (g_flash.read(g_programBuf, DATAFLASH_BASE + HEADER_SIZE, sz) != 0) return false;

    _programSize = (uint16_t)sz;
    return true;
}

bool MiniR4BLERuntimeClass::_persistToFlash()
{
    memcpy(g_storageBuf, MAGIC, 4);
    g_storageBuf[4] = (uint8_t)( _programSize        & 0xFF);
    g_storageBuf[5] = (uint8_t)((_programSize >> 8) & 0xFF);
    g_storageBuf[6] = 0;
    g_storageBuf[7] = 0;

    const uint32_t writeSize = roundUp4((uint32_t)HEADER_SIZE + _programSize);
    const uint32_t blocks    = (writeSize + DATAFLASH_BLOCK - 1) / DATAFLASH_BLOCK;

    for (uint32_t b = 0; b < blocks; ++b) {
        if (g_flash.erase(DATAFLASH_BASE + b * DATAFLASH_BLOCK,
                          DATAFLASH_BLOCK) != 0) return false;
    }
    return (g_flash.program(g_storageBuf, DATAFLASH_BASE, writeSize) == 0);
}

bool MiniR4BLERuntimeClass::_eraseFlash()
{
    // Wiping block 1 alone is enough -- the magic disappears, so any future
    // _loadFromFlash() call returns false.
    _programSize = 0;
    return (g_flash.erase(DATAFLASH_BASE, DATAFLASH_BLOCK) == 0);
}

// --- Enable-flag + sketch-ID storage (block 5) ------------------------------
// Fresh flash reads back as 0xFF, which we interpret as "enabled" so a
// brand-new R4 boots with BLE on by default. Writing 0x00 disables it.
// The sketch ID at offset 4 identifies the running compiled sketch so the
// runtime can detect a fresh USB reflash and wipe stale bytecode.

bool MiniR4BLERuntimeClass::_readEnableFlag()
{
    uint8_t v = 0xFF;
    if (g_flash.read(&v, ENABLE_FLAG_ADDR, 1) != 0) return true;
    return v != 0x00;
}

uint32_t MiniR4BLERuntimeClass::_readStoredSketchId()
{
    alignas(4) uint8_t buf[4] = {0xFF, 0xFF, 0xFF, 0xFF};
    if (g_flash.read(buf, SKETCH_ID_ADDR, 4) != 0) return SKETCH_ID_UNSET;
    return (uint32_t)buf[0]
         | ((uint32_t)buf[1] << 8)
         | ((uint32_t)buf[2] << 16)
         | ((uint32_t)buf[3] << 24);
}

void MiniR4BLERuntimeClass::_writeEnableFlag(bool enabled)
{
    // Preserve whatever sketch ID is already stored -- writing block 5 must
    // never clobber the USB-reflash detector.
    _writeBlock5(enabled, _readStoredSketchId());
}

void MiniR4BLERuntimeClass::_writeBlock5(bool enabled, uint32_t sketchId)
{
    // Erase the whole block, then program the enable-flag word + sketch-ID
    // word in one 8-byte shot. RA4M1 dataflash needs 4-byte-aligned writes.
    if (g_flash.erase(ENABLE_FLAG_ADDR, DATAFLASH_BLOCK) != 0) return;
    // Erased flash reads 0xFF everywhere. If we want the "default" state
    // (enabled + no-ID) we can skip the write entirely.
    if (enabled && sketchId == SKETCH_ID_UNSET) return;

    alignas(4) uint8_t buf[8];
    buf[0] = enabled ? 0xFF : 0x00;
    buf[1] = buf[2] = buf[3] = 0xFF;
    buf[4] = (uint8_t)( sketchId        & 0xFF);
    buf[5] = (uint8_t)((sketchId >>  8) & 0xFF);
    buf[6] = (uint8_t)((sketchId >> 16) & 0xFF);
    buf[7] = (uint8_t)((sketchId >> 24) & 0xFF);
    (void)g_flash.program(buf, ENABLE_FLAG_ADDR, sizeof(buf));
}

// --- Device name storage (block 6) ------------------------------------------
// A brand-new R4 has no name stored -- the runtime advertises MATRIX-R4-Runtime
// by default so the IDE finds it out of the box. Renaming persists here so a
// classroom can have MATRIX-3A-01, MATRIX-3A-02, ... all responding on the
// same NUS protocol. Names are printable ASCII (0x20..0x7E) up to 24 bytes.

bool MiniR4BLERuntimeClass::_readDeviceName(char* out, size_t maxLen)
{
    if (!out || maxLen < 2) return false;
    alignas(4) uint8_t buf[NAME_HEADER_SIZE + MAX_DEVICE_NAME];
    if (g_flash.read(buf, DEVICE_NAME_ADDR, sizeof(buf)) != 0) return false;
    for (uint8_t i = 0; i < 4; ++i) {
        if (buf[i] != DEVICE_NAME_MAGIC[i]) return false;
    }
    const uint8_t len = buf[4];
    if (len == 0 || len > MAX_DEVICE_NAME || len >= maxLen) return false;
    for (uint8_t i = 0; i < len; ++i) {
        const uint8_t c = buf[NAME_HEADER_SIZE + i];
        if (c < 0x20 || c > 0x7E) return false;
    }
    memcpy(out, buf + NAME_HEADER_SIZE, len);
    out[len] = '\0';
    return true;
}

bool MiniR4BLERuntimeClass::_writeDeviceName(const char* name)
{
    if (!name) return false;

    // Non-negotiable rule: the local name MUST start with "MATRIX-" so any
    // client can rediscover a forgotten hub via a namePrefix scan. Reject
    // any other prefix here even if the caller is a raw BLE tool that
    // bypassed the IDE's own validation.
    static const char PREFIX[] = "MATRIX-";
    for (uint8_t i = 0; i < sizeof(PREFIX) - 1; ++i) {
        if (name[i] != PREFIX[i]) return false;
    }

    uint8_t len = 0;
    while (name[len] != '\0' && len < MAX_DEVICE_NAME) {
        const uint8_t c = (uint8_t)name[len];
        if (c < 0x20 || c > 0x7E) return false;
        len++;
    }
    if (len == 0) return false;
    // Reject if the caller passed a longer string than we can persist.
    if (name[len] != '\0') return false;
    // Also reject if the payload is nothing but the prefix -- "MATRIX-" alone
    // isn't a useful hub name and would defeat the search-all UX.
    if (len == sizeof(PREFIX) - 1) return false;

    if (g_flash.erase(DEVICE_NAME_ADDR, DATAFLASH_BLOCK) != 0) return false;

    // Program header + name padded to a 4-byte boundary.
    alignas(4) uint8_t buf[NAME_HEADER_SIZE + MAX_DEVICE_NAME + 3];
    memset(buf, 0xFF, sizeof(buf));
    memcpy(buf, DEVICE_NAME_MAGIC, 4);
    buf[4] = len;
    memcpy(buf + NAME_HEADER_SIZE, name, len);
    const uint32_t writeSize = ((uint32_t)NAME_HEADER_SIZE + len + 3u) & ~3u;
    return (g_flash.program(buf, DEVICE_NAME_ADDR, writeSize) == 0);
}

// --- BLE responses ----------------------------------------------------------

void MiniR4BLERuntimeClass::_sendAck(uint8_t cmd, uint8_t status)
{
    uint8_t buf[3] = {RSP_ACK, cmd, status};
    g_txChar.writeValue(buf, 3);
}

void MiniR4BLERuntimeClass::_sendState()
{
    const uint16_t pc = _vm.pc();
    uint8_t buf[7] = {
        RSP_STATE,
        (uint8_t)(_vm.isRunning() ? 1 : 0),
        (uint8_t)(pc & 0xFF),
        (uint8_t)((pc >> 8) & 0xFF),
        (uint8_t)_vm.lastError(),
        (uint8_t)(_programSize & 0xFF),
        (uint8_t)((_programSize >> 8) & 0xFF),
    };
    g_txChar.writeValue(buf, 7);
}

// --- Command handler --------------------------------------------------------

void MiniR4BLERuntimeClass::_onRxWriteImpl(const uint8_t* data, int len)
{
    if (len < 1) return;
    const uint8_t cmd = data[0];

    switch (cmd) {
        case CMD_START:
            if (len < 3) { _sendAck(cmd, 1); return; }
            _receiveExpected = (uint16_t)data[1] | ((uint16_t)data[2] << 8);
            if (_receiveExpected == 0 || _receiveExpected > MAX_PROGRAM) {
                _sendAck(cmd, 2); return;
            }
            _receiveOffset = 0;
            _vm.halt();
            _sendAck(cmd, 0);
            break;

        case CMD_CHUNK: {
            const uint16_t chunkLen = (uint16_t)(len - 1);
            if (_receiveOffset + chunkLen > _receiveExpected) { _sendAck(cmd, 1); return; }
            memcpy(g_programBuf + _receiveOffset, data + 1, chunkLen);
            _receiveOffset += chunkLen;
            _sendAck(cmd, 0);
            break;
        }

        case CMD_END: {
            if (_receiveOffset != _receiveExpected) { _sendAck(cmd, 1); return; }
            _programSize = _receiveExpected;
            const bool ok = _persistToFlash();
            _vm.loadProgram(g_programBuf, _programSize);
            _vm.halt();   // wait for CMD_RUN
            _sendAck(cmd, ok ? 0 : 2);
            break;
        }

        case CMD_RUN:
            if (_programSize == 0) { _sendAck(cmd, 1); return; }
            _vm.loadProgram(g_programBuf, _programSize);
            _sendAck(cmd, 0);
            break;

        case CMD_STOP:
            _vm.halt();
            _sendAck(cmd, 0);
            _sendState();
            break;

        case CMD_ERASE: {
            _vm.halt();
            const bool ok = _eraseFlash();
            _sendAck(cmd, ok ? 0 : 2);
            break;
        }

        case CMD_INFO:
            _sendAck(cmd, 0);
            _sendState();
            break;

        case CMD_SET_NAME: {
            // Payload = raw ASCII name bytes (no null terminator). Empty
            // or too-long payloads fail; the write helper validates the
            // character set (printable ASCII 0x20..0x7E) and rejects on
            // any bad byte, so we don't need to double-check here.
            if (len < 2) { _sendAck(cmd, 1); return; }
            const uint16_t nameLen = (uint16_t)(len - 1);
            if (nameLen > MAX_DEVICE_NAME) { _sendAck(cmd, 2); return; }
            char name[MAX_DEVICE_NAME + 1];
            memcpy(name, data + 1, nameLen);
            name[nameLen] = '\0';
            _sendAck(cmd, _writeDeviceName(name) ? 0 : 3);
            break;
        }

        default:
            _sendAck(cmd, 0xFF);
            break;
    }
}
