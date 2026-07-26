/**
 * @file MiniR4WiFiRuntime.cpp
 * @brief Implementation of the always-on WiFi TCP runtime (OTA branch).
 *
 * Telemetry note: the 82-byte frame built in _buildTelemetryFrame() is a
 * deliberate duplicate of MiniR4BLERuntime.cpp's _sendTelemetry() (BLE
 * branch) so the IDE dashboard parses both sources with the same code.
 * The manual prefers duplication here over refactoring the BLE branch.
 * VM-specific fields (running flag, error, pc, program size) are zero on
 * this branch — there is no bytecode VM; sketches run native.
 */
#include "MiniR4WiFiRuntime.h"

#include "MatrixMiniR4.h"
#include "DataFlashBlockDevice.h"
#include <WiFiS3.h>
#include <OTAUpdate.h>
#include <stdarg.h>
#include <string.h>

// Optional diagnostic traces. Define MINIR4_WIFI_RUNTIME_DEBUG in the sketch
// (before including this header) to get Serial checkpoints.
#ifdef MINIR4_WIFI_RUNTIME_DEBUG
  #define WIFIRT_TRACE(x) do { Serial.print(F("[WIFIRT] ")); Serial.println(x); } while (0)
#else
  #define WIFIRT_TRACE(x) do {} while (0)
#endif

namespace {

constexpr uint16_t UDP_DISCOVERY_PORT = 47801;
constexpr uint16_t TCP_COMMAND_PORT   = 47802;
// Baud the runtime opens the USB config channel with. The IDE probes this
// first and then 9600, the baud the Serial block emits, because a user sketch
// re-begins Serial after us and wins.
constexpr uint32_t SERIAL_CONFIG_BAUD = 115200;
constexpr const char* AP_PASSWORD     = "matrix2026";
constexpr uint32_t STA_JOIN_TIMEOUT_MS  = 10000;  ///< per begin() attempt
constexpr uint32_t STA_RETRY_INTERVAL_MS = 30000; ///< re-try cadence in poll()
constexpr uint32_t TICK_INTERVAL_MS   = 5;        ///< real work cadence in tick()

// Outgoing log budget. Each frame is a synchronous ~100 ms modem write, the
// same budget telemetry spends, so 10/s — the figure first sketched — would
// consume the radio entirely and leave nothing for the dashboard. 5/s is
// still faster than anyone reads, and the burst lets an ordinary print
// (a handful of lines, then silence) through with no delay at all.
constexpr uint8_t  LOG_LINES_PER_SEC     = 5;
constexpr uint8_t  LOG_BURST             = 8;
constexpr uint32_t LOG_NOTE_INTERVAL_MS  = 1000;  ///< "N dropped" summary cadence

// --- Dataflash config record (block 6, magic 'MBRW') ------------------------
// Erased flash reads 0xFF everywhere; missing magic = "no config, defaults".
//   0..3    'M','B','R','W'
//   4       name length  (1..24, 0xFF/0 = unset)
//   5..28   name bytes   (24 reserved)
//   29      ssid length  (1..32, 0xFF/0 = unset)
//   30..61  ssid bytes   (32 reserved)
//   62      pass length  (0..63, 0xFF = unset)
//   63..125 pass bytes   (63 reserved)
//   126..127 cached MAC bytes 4..5 (0xFF,0xFF = unset). WiFi.macAddress()
//            returns zeros until the WiFi stack is up, so the first boot
//            reads the real MAC only after begin/beginAP; it is cached here
//            so every later boot names the AP correctly from the start.
//   128     AP password length (8..63, 0xFF/invalid = default "matrix2026")
//   129..191 AP password bytes (63 reserved)
// Records written before the AP-password extension are 128 bytes; the tail
// reads back 0xFF (erased) which parses as "default password" — compatible.
constexpr uint32_t DATAFLASH_BLOCK   = 1024;
constexpr uint32_t CONFIG_ADDR       = 6 * DATAFLASH_BLOCK;  // block 6
constexpr uint32_t CONFIG_SIZE       = 192;                  // 4-aligned
constexpr uint8_t  CONFIG_MAGIC[4]   = {'M', 'B', 'R', 'W'};
constexpr uint8_t  MAX_NAME_LEN      = 24;
constexpr uint8_t  MAX_SSID_LEN      = 32;
constexpr uint8_t  MAX_PASS_LEN      = 63;
constexpr uint32_t CFG_OFF_NAMELEN   = 4;
constexpr uint32_t CFG_OFF_NAME      = 5;
constexpr uint32_t CFG_OFF_SSIDLEN   = 29;
constexpr uint32_t CFG_OFF_SSID      = 30;
constexpr uint32_t CFG_OFF_PASSLEN   = 62;
constexpr uint32_t CFG_OFF_PASS      = 63;
constexpr uint32_t CFG_OFF_MAC      = 126;
constexpr uint32_t CFG_OFF_APPASSLEN = 128;
constexpr uint32_t CFG_OFF_APPASS    = 129;
constexpr uint8_t  MIN_AP_PASS_LEN   = 8;   // WPA2 minimum
constexpr uint8_t  MAX_AP_PASS_LEN   = 63;

// Telemetry frame tag — same value as the BLE branch's RSP_TELEMETRY so the
// IDE-side frame parser is source-agnostic.
constexpr uint8_t RSP_TELEMETRY   = 0xA2;
constexpr uint8_t TELEMETRY_BYTES = 82;

// --- Ephemeral VM ------------------------------------------------------------
// Program storage: RA4M1 has 32 KB of SRAM. This runtime baseline uses ~18 KB;
// 5 KB for VM bytecode leaves ample stack (measured 14 KB free with WiFi + VM
// compiled in). 5120 bytes is empirically enough for the biggest Blockly
// programs the BLE branch shipped, and matches the "ceiling" documented there
// (block density ~5-6 B/block → ~900-1000 blocks).
// Baseline runtime uses ~18 KB SRAM (WiFiS3 + Adafruit_SSD1306 + MiniR4
// buffers). The static budget is hard and small: UNOWIFIR4's linker script
// reserves a FIXED 8 KB heap (BSP_CFG_HEAP_BYTES) and a FIXED 1 KB main
// stack (BSP_CFG_STACK_MAIN_BYTES) out of 32 KB, minus a 256-byte vector
// table — so everything static must fit in 23296 bytes, and going over is
// a hard link error ("section .stack_dummy overlaps section .heap"), not a
// warning. Measured: 5 KB overflowed by ~900 B; 4 KB left only 106 B of
// slack, which the R3 v2 line buffer and the debug state consumed. 3584 B
// restores ~450 B of slack and still covers ~600-700 real Blockly blocks at
// the 5-6 B/block density measured on the BLE branch. Programs bigger than
// that belong on the OTA path, which has no ceiling at all.
constexpr uint16_t VM_MAX_PROGRAM = 3584;
alignas(4) uint8_t g_vmProgram[VM_MAX_PROGRAM];
constexpr uint8_t  VM_STEPS_PER_POLL = 32;

// --- Saved VM record (blocks 1..5, magic 'MBVM') -----------------------------
// A saved program lets the hub leave the classroom running the student's
// blocks with no notebook: boot → load → run. Layout (little-endian):
//   0..3    'M','B','V','M'
//   4..5    program size (u16, 1..VM_MAX_PROGRAM)
//   6..7    CRC-16/CCITT-FALSE over the program bytes
//   8..11   sketch id the program was uploaded against (0 = "any")
//   12..15  reserved (0xFF)
//   16..    program bytes
// 16 + 3584 = 3600 bytes spans four 1 KB blocks. The CRC is what makes a
// half-written record (power cut mid-save) safe: it fails validation and the
// hub simply boots with no program instead of executing garbage.
constexpr uint32_t VM_STORE_ADDR    = 1 * DATAFLASH_BLOCK;   // block 1
constexpr uint8_t  VM_STORE_BLOCKS  = 4;                     // blocks 1..4
constexpr uint32_t VM_STORE_HEADER  = 16;
constexpr uint8_t  VM_STORE_MAGIC[4] = {'M', 'B', 'V', 'M'};

// CRC-16/CCITT-FALSE. Chosen over a checksum because a stuck flash bit is
// exactly the failure a sum can miss.
uint16_t crc16(const uint8_t* data, size_t len)
{
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= (uint16_t)data[i] << 8;
        for (uint8_t b = 0; b < 8; b++) {
            crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021)
                                 : (uint16_t)(crc << 1);
        }
    }
    return crc;
}

WiFiUDP    g_udp;
WiFiServer g_server(TCP_COMMAND_PORT);
WiFiClient g_client;
OTAUpdate  g_ota;

DataFlashBlockDevice& g_flash = DataFlashBlockDevice::getInstance();

// --- Minimal flat-JSON field extraction -------------------------------------
// Command lines are small, flat, single-level objects produced by the IDE;
// a full JSON library would cost flash/RAM for nothing. Handles \" and \\
// escapes inside strings (SSIDs/passwords may contain them).

const char* jsonFindKey(const char* json, const char* key)
{
    char pat[40];
    snprintf(pat, sizeof(pat), "\"%s\"", key);
    const char* p = strstr(json, pat);
    if (!p) return nullptr;
    p += strlen(pat);
    while (*p == ' ' || *p == '\t') p++;
    if (*p != ':') return nullptr;
    p++;
    while (*p == ' ' || *p == '\t') p++;
    return p;
}

bool jsonStr(const char* json, const char* key, char* out, size_t cap)
{
    const char* p = jsonFindKey(json, key);
    if (!p || *p != '"') return false;
    p++;
    size_t n = 0;
    while (*p && *p != '"') {
        char c = *p++;
        if (c == '\\' && *p) {
            const char esc = *p++;
            if      (esc == 'n') c = '\n';
            else if (esc == 't') c = '\t';
            else                 c = esc;   // covers \" \\ \/
        }
        if (n + 1 < cap) out[n++] = c;
    }
    out[n] = '\0';
    return *p == '"';
}

bool jsonInt(const char* json, const char* key, long& val)
{
    const char* p = jsonFindKey(json, key);
    if (!p) return false;
    char* end = nullptr;
    const long v = strtol(p, &end, 10);
    if (end == p) return false;
    val = v;
    return true;
}

bool jsonBool(const char* json, const char* key, bool& val)
{
    const char* p = jsonFindKey(json, key);
    if (!p) return false;
    if (!strncmp(p, "true", 4))  { val = true;  return true; }
    if (!strncmp(p, "false", 5)) { val = false; return true; }
    return false;
}

// JSON-escape a string for embedding in an outgoing frame (names may contain
// quotes; keep the output valid no matter what is stored in flash).
// Control characters (< 0x20) are dropped so a stray \r or NUL in a user
// log message can't break the receiver's line-by-line NDJSON parse.
void jsonEscape(const char* in, char* out, size_t cap)
{
    size_t n = 0;
    for (; *in && n + 2 < cap; in++) {
        const unsigned char c = (unsigned char)*in;
        if (c < 0x20) continue;                // drop control chars
        if (c == '"' || c == '\\') {
            if (n + 3 >= cap) break;
            out[n++] = '\\';
        }
        out[n++] = (char)c;
    }
    out[n] = '\0';
}

// --- base64 (for the binary telemetry blob inside NDJSON) -------------------

const char B64_ALPHABET[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Inverse alphabet lookup (returns 0..63, or 255 for invalid byte / padding).
// Static init at file scope; ~256 B of flash, saves per-decode looping.
struct B64Table {
    uint8_t t[256];
    constexpr B64Table() : t{} {
        for (int i = 0; i < 256; i++) t[i] = 255;
        for (int i = 0; i < 26; i++) t[(uint8_t)('A' + i)] = i;
        for (int i = 0; i < 26; i++) t[(uint8_t)('a' + i)] = 26 + i;
        for (int i = 0; i < 10; i++) t[(uint8_t)('0' + i)] = 52 + i;
        t[(uint8_t)'+'] = 62;
        t[(uint8_t)'/'] = 63;
    }
};
constexpr B64Table B64_DECODE_TABLE{};

// Decode base64 into out (caller-provided buffer, at least ceil(len*3/4) bytes).
// Returns decoded byte count, or 0 on any invalid character. Padding '=' is
// tolerated but not required.
size_t base64Decode(const char* in, uint8_t* out, size_t outCap)
{
    uint32_t acc = 0;
    int      bits = 0;
    size_t   n = 0;
    for (const char* p = in; *p; p++) {
        const char c = *p;
        if (c == '=' || c == '\r' || c == '\n' || c == ' ') continue;
        const uint8_t v = B64_DECODE_TABLE.t[(uint8_t)c];
        if (v == 255) return 0;   // invalid character
        acc = (acc << 6) | v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            if (n >= outCap) return 0;   // overflow
            out[n++] = (uint8_t)((acc >> bits) & 0xFF);
        }
    }
    return n;
}

void base64Encode(const uint8_t* in, size_t len, char* out)
{
    size_t o = 0;
    for (size_t i = 0; i < len; i += 3) {
        const uint32_t b0 = in[i];
        const uint32_t b1 = (i + 1 < len) ? in[i + 1] : 0;
        const uint32_t b2 = (i + 2 < len) ? in[i + 2] : 0;
        const uint32_t triple = (b0 << 16) | (b1 << 8) | b2;
        out[o++] = B64_ALPHABET[(triple >> 18) & 0x3F];
        out[o++] = B64_ALPHABET[(triple >> 12) & 0x3F];
        out[o++] = (i + 1 < len) ? B64_ALPHABET[(triple >> 6) & 0x3F] : '=';
        out[o++] = (i + 2 < len) ? B64_ALPHABET[triple & 0x3F] : '=';
    }
    out[o] = '\0';
}

}  // namespace

// --- The singleton instance -------------------------------------------------

MiniR4WiFiRuntimeClass WiFiRuntime;

MiniR4WiFiRuntimeClass::MiniR4WiFiRuntimeClass()
    : _netMode(NET_DOWN)
    , _begun(false)
    , _nameCustom(false)
    , _lastStaRetryMs(0)
    , _tickLastMs(0)
    , _waitingStart(false)
    , _startRequested(false)
    , _lineLen(0)
    , _serialLen(0)
    , _replyToSerial(false)
    , _logLineLen(0)
    , _logTokenMs(0)
    , _logNoteMs(0)
    , _logTokens(LOG_BURST)
    , _logDropped(0)
    , _tmOn(false)
    , _tmIntervalMs(100)
    , _tmLastMs(0)
    , _dhtEnabledMask(0)
    , _dhtLastAppliedMask(0)
    , _vmProgramSize(0)
    , _vmRxExpected(0)
    , _vmRxOffset(0)
    , _vmReceiving(false)
    , _sketchId(0)
    , _vmStored(false)
    , _inVm(false)
    , _vmDebugOn(false)
    , _vmPaused(false)
    , _vmStepOnce(false)
    // 10 Hz, not the 20 the roadmap sketched: every outgoing frame costs a
    // synchronous ~100 ms modem write on this platform (the same ceiling
    // that caps telemetry at ~9.4 Hz), and the pc stream shares that budget
    // with telemetry. 10 Hz already reads as "live" for block highlighting.
    , _vmPcIntervalMs(100)
    , _vmPcLastMs(0)
    , _vmPcLastSent(0xFFFF)
    , _vmBreakCount(0)
    , _vmBpArmed(true)
{
    // FULL zero of the char buffers, not just [0]='\0'. Any read past the
    // first byte (jsonEscape iterating on stale bytes after a bad length
    // field, strlen wandering into the next field) would otherwise pick up
    // undefined memory — the exact class of bug that best explains the
    // "rename + AP password + reboot leaves the hub unreachable" report
    // we couldn't fully reproduce in bench testing. Cheap insurance.
    memset(_name,  0, sizeof(_name));
    memset(_mac4,  0, sizeof(_mac4));
    memset(_ssid,  0, sizeof(_ssid));
    memset(_pass,  0, sizeof(_pass));
    memset(_apPass, 0, sizeof(_apPass));
    memset(_apSsid, 0, sizeof(_apSsid));
    memset(_serialBuf, 0, sizeof(_serialBuf));
    memset(_logLine, 0, sizeof(_logLine));
    memset(_vmBreak, 0, sizeof(_vmBreak));
    _macCache[0] = _macCache[1] = 0xFF;
    strncpy(_apPass, AP_PASSWORD, sizeof(_apPass) - 1);
    _apPassCustom = false;
}

// --- Public API -------------------------------------------------------------

void MiniR4WiFiRuntimeClass::begin()
{
    if (_begun) return;
    _begun = true;

    // Bring the USB config channel up FIRST, before anything that can fail.
    // Everything below this line depends on the WiFi module; the cable does
    // not, and a hub whose radio is misconfigured or unresponsive must still
    // be recoverable from the IDE without reflashing it.
    //
    // A user sketch is free to call Serial.begin() again with its own baud
    // (the wrapper runs userSetup() after us) — the channel simply follows
    // whatever baud ends up set, which is why the IDE probes both.
    Serial.begin(SERIAL_CONFIG_BAUD);

    if (WiFi.status() == WL_NO_MODULE) {
        WIFIRT_TRACE(F("no WiFi module; serial config channel only"));
        return;
    }

    // Factory-reset gesture: BOTH buttons held at boot wipes the config
    // (name, network credentials, AP password, MAC cache). This is the
    // no-IDE rescue for a hub whose custom AP password was forgotten —
    // afterwards the AP is MBR4-<mac4> / "matrix2026" again.
    if (MiniR4.BTN_UP.getState() && MiniR4.BTN_DOWN.getState()) {
        factoryReset();
        _oledStatus("RESET OK", "defaults restored");
        delay(1500);
    }

    _readConfig(_name, _ssid, _pass);
    _fillIdentity();

    // Route VM's DELAY_MS yield through our transport-only poll so long
    // waits inside bytecode don't starve UDP/TCP.
    MiniR4VM::setYieldCallback([]() { WiFiRuntime.pollNetworkOnly(); });

    // Recovery gesture: BTN_UP held at boot => network-only loop, the user
    // sketch never runs. Guarantees a hub with a crashing/blocking sketch
    // can always be re-flashed over the air (manual §2.4 — mandatory).
    const bool recovery = MiniR4.BTN_UP.getState() && !MiniR4.BTN_DOWN.getState();

    _startNetwork(recovery);

    if (recovery) {
        _recoveryLoop();   // never returns
    }

    // Restore a saved VM program and start it (R2 v2 — "leave the notebook
    // behind"). Deliberately AFTER the recovery check: BTN_UP at power-on
    // still rescues a hub whose saved bytecode misbehaves, because recovery
    // never reaches this line. While the restored program runs the wrapper
    // skips userLoop, exactly as it does for a freshly uploaded VM.
    if (_loadVmProgram()) {
        _vm.loadProgram(g_vmProgram, _vmProgramSize);
        _vm.reset();
        WIFIRT_TRACE(F("saved VM program restored"));
    }
}

void MiniR4WiFiRuntimeClass::poll()
{
    if (!_begun) return;

    // Before the network guard, always: the USB channel is the fallback for
    // exactly the situation where the network is down.
    _pollSerial();

    if (_netMode == NET_DOWN) {
        // Periodic STA re-try (e.g. router came back after a power cut).
        if (millis() - _lastStaRetryMs > STA_RETRY_INTERVAL_MS) {
            _startNetwork(false);
        }
        return;
    }

    _pollDiscovery();
    _pollCommands();
    _pollTelemetry();
    _pollVm();
}

void MiniR4WiFiRuntimeClass::pollNetworkOnly()
{
    if (!_begun || _netMode == NET_DOWN) return;
    _pollDiscovery();
    _pollCommands();
    _pollTelemetry();
    // Deliberately NOT _pollVm() — this is called from inside VM.step() to
    // keep the transport alive during DELAY_MS; re-entering the VM would
    // overflow the stack.
}

bool MiniR4WiFiRuntimeClass::isRunningVM() const
{
    return _vm.isRunning();
}

// --- Ephemeral VM handlers --------------------------------------------------

void MiniR4WiFiRuntimeClass::_handleVmStart(long size)
{
    if (size <= 0 || size > VM_MAX_PROGRAM) {
        _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_start\",\"ok\":false,\"err\":\"size\"}");
        return;
    }
    // Halt any running program and reset receive state.
    _vm.halt();
    _vmProgramSize = 0;
    _vmRxExpected  = (uint16_t)size;
    _vmRxOffset    = 0;
    _vmReceiving   = true;
    _vmPaused      = false;   // a new upload always starts clean
    _vmStepOnce    = false;
    _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_start\",\"ok\":true}");
}

void MiniR4WiFiRuntimeClass::_handleVmChunk(const char* b64)
{
    if (!_vmReceiving) {
        _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_chunk\",\"ok\":false,\"err\":\"not receiving\"}");
        return;
    }
    // Decode straight into the destination buffer; base64 growth is <4/3
    // so the input line is bounded by (chunk*4/3 + JSON overhead), well
    // under our _lineBuf's 192 B cap when chunks stay at ~120 B.
    const size_t decoded = base64Decode(b64, g_vmProgram + _vmRxOffset,
                                        VM_MAX_PROGRAM - _vmRxOffset);
    if (decoded == 0) {
        _vmReceiving = false;
        _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_chunk\",\"ok\":false,\"err\":\"decode\"}");
        return;
    }
    _vmRxOffset += (uint16_t)decoded;
    if (_vmRxOffset > _vmRxExpected) {
        _vmReceiving = false;
        _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_chunk\",\"ok\":false,\"err\":\"overflow\"}");
        return;
    }
    _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_chunk\",\"ok\":true,\"off\":%u}", _vmRxOffset);
}

void MiniR4WiFiRuntimeClass::_handleVmEnd(bool save)
{
    if (!_vmReceiving) {
        _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_end\",\"ok\":false,\"err\":\"not receiving\"}");
        return;
    }
    if (_vmRxOffset != _vmRxExpected) {
        _vmReceiving = false;
        _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_end\",\"ok\":false,\"err\":\"short\"}");
        return;
    }
    _vmProgramSize = _vmRxOffset;
    _vmReceiving   = false;
    const bool saved = save ? _saveVmProgram() : false;
    _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_end\",\"ok\":true,\"size\":%u,\"saved\":%s}",
              _vmProgramSize, saved ? "true" : "false");
    if (save && !saved) log("VM save FAILED (dataflash)");
}

void MiniR4WiFiRuntimeClass::_handleVmRun()
{
    if (_vmProgramSize == 0) {
        _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_run\",\"ok\":false,\"err\":\"empty\"}");
        return;
    }
    _vm.loadProgram(g_vmProgram, _vmProgramSize);
    _vm.reset();
    // A fresh run always starts unpaused with breakpoints live again —
    // otherwise "Run" after a paused session would appear to do nothing.
    // Armed breakpoints themselves survive: the student set them on purpose.
    _vmPaused     = false;
    _vmStepOnce   = false;
    _vmBpArmed    = true;
    _vmPcLastSent = 0xFFFF;
    // loadProgram + reset leaves _running=true (VM starts on the first
    // step()); the poll loop below drives it.
    _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_run\",\"ok\":true}");
    char buf[64];
    snprintf(buf, sizeof(buf), "VM started (%u bytes)", _vmProgramSize);
    log(buf);
}

bool MiniR4WiFiRuntimeClass::_vmIsBreakpoint(uint16_t pc) const
{
    for (uint8_t i = 0; i < _vmBreakCount; i++) {
        if (_vmBreak[i] == pc) return true;
    }
    return false;
}

void MiniR4WiFiRuntimeClass::_sendPcFrame(bool force)
{
    if (!_vmDebugOn) return;
    const uint16_t pc  = _vm.pc();
    const uint32_t now = millis();
    if (!force) {
        if (now - _vmPcLastMs < _vmPcIntervalMs) return;
        if (pc == _vmPcLastSent) return;   // parked on the same instruction
    }
    _vmPcLastMs   = now;
    _vmPcLastSent = pc;
    _sendJson("{\"t\":\"pc\",\"addr\":%u,\"run\":%d}",
              (unsigned)pc, _vmPaused ? 0 : 1);
}

void MiniR4WiFiRuntimeClass::_sendVarsFrame()
{
    // Worst case 17 + 16*11 + 15 + 2 = 210 bytes, inside _sendJson's frame.
    char buf[240];
    int o = snprintf(buf, sizeof(buf), "{\"t\":\"vars\",\"v\":[");
    for (uint8_t i = 0; i < MiniR4VM::VAR_COUNT && o > 0 && o < (int)sizeof(buf); i++) {
        o += snprintf(buf + o, sizeof(buf) - o, "%s%ld",
                      i ? "," : "", (long)_vm.varAt(i));
    }
    if (o > 0 && o < (int)sizeof(buf)) snprintf(buf + o, sizeof(buf) - o, "]}");
    _sendJson("%s", buf);
}

void MiniR4WiFiRuntimeClass::_pollVm()
{
    if (!_vm.isRunning()) return;

    // Re-entry guard. tick() steps the VM so a program sent while user code
    // is parked actually runs, and tick() is reachable from user code that
    // the VM itself may have resumed — one guard here is cheaper to reason
    // about than auditing every path that can reach this function.
    if (_inVm) return;
    _inVm = true;
    struct Guard {
        bool* f;
        ~Guard() { *f = false; }
    } guard{ &_inVm };

    // Paused: keep reporting where we are (the IDE may have just connected
    // and needs to know which block is highlighted) but execute nothing.
    if (_vmPaused && !_vmStepOnce) {
        _sendPcFrame(false);
        return;
    }

    for (uint8_t i = 0; i < VM_STEPS_PER_POLL; i++) {
        // Breakpoint test runs BEFORE the instruction at that pc, so the
        // block the IDE highlights is the one about to execute — matching
        // what a student expects from "stop here". _vmBpArmed is cleared on
        // resume/step so we don't immediately re-trigger on the same pc.
        if (_vmBpArmed && _vmIsBreakpoint(_vm.pc())) {
            _vmPaused   = true;
            _vmStepOnce = false;
            _sendPcFrame(true);
            char buf[48];
            snprintf(buf, sizeof(buf), "VM paused at breakpoint pc=%u",
                     (unsigned)_vm.pc());
            log(buf);
            return;
        }
        _vmBpArmed = true;

        const auto r = _vm.step();
        if (r != MiniR4VM::Result::OK) {
            // Report termination once — HALTED is the normal exit path
            // (program hit an explicit HALT opcode), everything else is an
            // error worth surfacing in the console.
            char buf[64];
            if (r == MiniR4VM::Result::HALTED) {
                snprintf(buf, sizeof(buf), "VM halted at pc=%u", (unsigned)_vm.pc());
            } else {
                snprintf(buf, sizeof(buf), "VM error %d at pc=%u",
                         (int)r, (unsigned)_vm.pc());
            }
            _sendPcFrame(true);
            log(buf);
            return;
        }

        if (_vmStepOnce) {           // single-step consumed
            _vmStepOnce = false;
            _vmPaused   = true;
            _sendPcFrame(true);
            return;
        }
    }
    _sendPcFrame(false);
}

// --- VM persistence ---------------------------------------------------------

bool MiniR4WiFiRuntimeClass::_saveVmProgram()
{
    if (_vmProgramSize == 0 || _vmProgramSize > VM_MAX_PROGRAM) return false;

    alignas(4) uint8_t header[VM_STORE_HEADER];
    memset(header, 0xFF, sizeof(header));
    memcpy(header, VM_STORE_MAGIC, 4);
    header[4] = (uint8_t)(_vmProgramSize & 0xFF);
    header[5] = (uint8_t)(_vmProgramSize >> 8);
    const uint16_t crc = crc16(g_vmProgram, _vmProgramSize);
    header[6] = (uint8_t)(crc & 0xFF);
    header[7] = (uint8_t)(crc >> 8);
    header[8]  = (uint8_t)(_sketchId & 0xFF);
    header[9]  = (uint8_t)(_sketchId >> 8);
    header[10] = (uint8_t)(_sketchId >> 16);
    header[11] = (uint8_t)(_sketchId >> 24);

    for (uint8_t b = 0; b < VM_STORE_BLOCKS; b++) {
        if (g_flash.erase(VM_STORE_ADDR + b * DATAFLASH_BLOCK,
                          DATAFLASH_BLOCK) != 0) return false;
    }
    // Program bytes first, header last. A power cut between the two leaves
    // no valid magic, so the next boot reads "nothing saved" instead of a
    // truncated program whose CRC happens to be uncheckable.
    // Round up to the flash's 4-byte program unit; the padding is read back
    // but never CRC'd (the header's size field bounds the real program).
    const uint32_t progAligned = ((uint32_t)_vmProgramSize + 3u) & ~3u;
    if (g_flash.program(g_vmProgram, VM_STORE_ADDR + VM_STORE_HEADER,
                        progAligned) != 0) return false;
    if (g_flash.program(header, VM_STORE_ADDR, VM_STORE_HEADER) != 0) return false;

    _vmStored = true;
    return true;
}

bool MiniR4WiFiRuntimeClass::_loadVmProgram()
{
    alignas(4) uint8_t header[VM_STORE_HEADER];
    if (g_flash.read(header, VM_STORE_ADDR, VM_STORE_HEADER) != 0) return false;
    if (memcmp(header, VM_STORE_MAGIC, 4) != 0) return false;

    const uint16_t size = (uint16_t)header[4] | ((uint16_t)header[5] << 8);
    if (size == 0 || size > VM_MAX_PROGRAM) return false;
    const uint16_t crc = (uint16_t)header[6] | ((uint16_t)header[7] << 8);
    const uint32_t id  = (uint32_t)header[8]         |
                         ((uint32_t)header[9]  << 8) |
                         ((uint32_t)header[10] << 16) |
                         ((uint32_t)header[11] << 24);

    const uint32_t progAligned = ((uint32_t)size + 3u) & ~3u;
    if (g_flash.read(g_vmProgram, VM_STORE_ADDR + VM_STORE_HEADER,
                     progAligned) != 0) return false;
    if (crc16(g_vmProgram, size) != crc) return false;

    // A saved program belongs to exactly the sketch it was uploaded against.
    // After a USB/OTA reflash the ids differ: drop it rather than run
    // yesterday's blocks on top of a program the student has since replaced.
    //
    // Exact equality, with no "0 means any sketch" escape hatch: an earlier
    // cut treated a stored 0 as a wildcard so that id-less bench sketches
    // could still run saved programs, and hardware promptly showed why that
    // is wrong — a program saved by the standalone runtime example was
    // adopted by the next, completely unrelated sketch flashed over USB, and
    // its userLoop never ran because the VM had taken over. A sketch with no
    // declared id (0) still matches programs it saved itself, which is all
    // the bench case ever needed.
    if (id != _sketchId) {
        _forgetVmProgram();
        return false;
    }

    _vmProgramSize = size;
    _vmStored      = true;
    return true;
}

bool MiniR4WiFiRuntimeClass::_forgetVmProgram()
{
    // Erasing block 1 removes the magic, which is all validation looks at.
    // Leaving blocks 2..5 alone saves four erase cycles per call on flash
    // rated for a finite number of them.
    const bool ok = (g_flash.erase(VM_STORE_ADDR, DATAFLASH_BLOCK) == 0);
    if (ok) _vmStored = false;
    return ok;
}

bool MiniR4WiFiRuntimeClass::tick(bool cond)
{
    if (!_begun) return cond;

    // Throttle: a `while (!button)` gate calls this as fast as the CPU can
    // spin, and each discovery poll costs a modem transaction. Doing the real
    // work on a 5 ms cadence matches what a normal loop() achieves anyway
    // (the runtime example is poll() + delay(5)) while leaving the student's
    // loop essentially free.
    const uint32_t now = millis();
    if (now - _tickLastMs < TICK_INTERVAL_MS) return cond;
    _tickLastMs = now;

    _pollSerial();
    if (_netMode != NET_DOWN) {
        _pollDiscovery();
        _pollCommands();
        _pollTelemetry();
    }
    // Advance the VM too. Without this, sending a VM program while the robot
    // sits at its start gate loads it and never runs it: the driver's poll()
    // is what normally steps the VM, and poll() is exactly what a blocked
    // userLoop is not reaching. Since the gate is where a robot spends most
    // of its idle life, "Send VM (fast)" would appear to do nothing most of
    // the time.
    //
    // Not the recursion that blew the stack on the BLE branch (a9db855):
    // that was DELAY_MS yielding back into the VM. The VM's yield callback is
    // pollNetworkOnly(), which never steps, and _pollVm() guards re-entry, so
    // the depth here is bounded at one.
    _pollVm();
    return cond;
}

void MiniR4WiFiRuntimeClass::waitForStart()
{
    _waitingStart   = true;
    _startRequested = false;
    log("Waiting for start (BTN_UP, or Start in the IDE)");

    while (!_startRequested && !MiniR4.BTN_UP.getState()) {
        tick();
    }

    const bool remote = _startRequested;
    _waitingStart   = false;
    _startRequested = false;

    // Wait for the button to come back up, so the same press is not also
    // consumed by whatever the program reads next — students routinely
    // follow the gate with another button check, and a 200 ms human press
    // would otherwise satisfy both.
    while (MiniR4.BTN_UP.getState()) tick();

    log(remote ? "Started (remote)" : "Started (BTN_UP)");
}

void MiniR4WiFiRuntimeClass::safeDelay(uint32_t ms)
{
    const uint32_t start = millis();
    while (millis() - start < ms) {
        poll();
        const uint32_t elapsed   = millis() - start;
        const uint32_t remaining = (elapsed < ms) ? (ms - elapsed) : 0;
        delay(remaining < 20 ? remaining : 20);
    }
}

void MiniR4WiFiRuntimeClass::log(const char* msg)
{
    if (!msg || !*msg) return;
    if (!g_client || !g_client.connected()) {   // no client, silent drop
        _logDropped = 0;                        // nothing to apologise for later
        return;
    }

    // --- Rate limit -------------------------------------------------------
    // A student printing inside a `while` loop generates lines far faster
    // than the radio can drain them, and every frame blocks the sketch for
    // ~100 ms. Unthrottled, that starves telemetry, makes the robot sluggish
    // and floods the console with output nobody can read anyway.
    //
    // Token bucket rather than a flat cap: a burst of a few lines — which is
    // what a print usually is — goes out instantly, while a loop settles to
    // a readable rate that leaves the modem budget for telemetry.
    const uint32_t now = millis();
    const uint32_t elapsed = now - _logTokenMs;
    const uint32_t gained  = (elapsed * LOG_LINES_PER_SEC) / 1000UL;
    if (gained) {
        const uint32_t tokens = (uint32_t)_logTokens + gained;
        _logTokens = (uint8_t)(tokens > LOG_BURST ? LOG_BURST : tokens);
        // Advance by exactly what we granted, so the leftover milliseconds
        // still count towards the next token instead of being rounded away.
        _logTokenMs += (gained * 1000UL) / LOG_LINES_PER_SEC;
    }

    if (_logTokens == 0) {
        if (_logDropped < 0xFFFF) _logDropped++;
        return;
    }
    _logTokens--;

    char escaped[200];

    // Tell the user output was thrown away — silently losing their prints
    // would be worse than the flood, because they would trust what they see.
    //
    // But at most once a second: under a continuous flood every accepted line
    // has drops behind it, so emitting a note each time doubled the frames on
    // the wire and gave back half the budget this limit exists to protect
    // (measured: 10.3 frames/s against a 5/s target). Summarising instead
    // keeps the warning useful and the radio quiet.
    if (_logDropped && (now - _logNoteMs) >= LOG_NOTE_INTERVAL_MS) {
        char note[64];
        snprintf(note, sizeof(note), "... %u line(s) dropped (printing too fast)",
                 (unsigned)_logDropped);
        _logDropped = 0;
        _logNoteMs  = now;
        jsonEscape(note, escaped, sizeof(escaped));
        _sendJson("{\"t\":\"log\",\"s\":\"%s\"}", escaped);
    }

    // Escaping up front keeps _sendJson's format string tiny — the msg is
    // pre-safe by the time it goes into vsnprintf.
    jsonEscape(msg, escaped, sizeof(escaped));
    _sendJson("{\"t\":\"log\",\"s\":\"%s\"}", escaped);
}

// --- Print mirror (R3 v2) ---------------------------------------------------
// Buffer characters until a println terminates the line, so a sequence of
// print() calls arrives at the console as the one line the serial monitor
// would show. Note we buffer unconditionally: whether a client is attached
// is decided at flush time by log(), which keeps print() cost identical
// whether or not the IDE is watching.

void MiniR4WiFiRuntimeClass::_logAppend(const String& s)
{
    const char* p = s.c_str();
    for (; *p; p++) {
        // A newline inside a print() ends the line too — student code often
        // does Serial.print("a\n") instead of println.
        if (*p == '\n') { _logFlush(); continue; }
        if (*p == '\r') continue;
        if (_logLineLen >= sizeof(_logLine) - 1) _logFlush();
        _logLine[_logLineLen++] = *p;
    }
}

void MiniR4WiFiRuntimeClass::_logFlush()
{
    if (_logLineLen == 0) return;   // bare println(): nothing worth sending
    _logLine[_logLineLen] = '\0';
    _logLineLen = 0;
    log(_logLine);
}

bool MiniR4WiFiRuntimeClass::setDeviceName(const char* name)
{
    if (!name) return false;
    const size_t len = strlen(name);
    if (len == 0 || len > MAX_NAME_LEN) return false;
    for (size_t i = 0; i < len; i++) {
        if (name[i] < 0x20 || name[i] > 0x7E) return false;
    }
    if (!_writeConfig(name, _ssid, _pass)) return false;
    strncpy(_name, name, sizeof(_name) - 1);
    _name[sizeof(_name) - 1] = '\0';
    _nameCustom = true;
    return true;
}

bool MiniR4WiFiRuntimeClass::setCredentials(const char* ssid, const char* pass)
{
    if (!ssid) return false;
    const size_t slen = strlen(ssid);
    const size_t plen = pass ? strlen(pass) : 0;
    if (slen == 0 || slen > MAX_SSID_LEN || plen > MAX_PASS_LEN) return false;
    if (!_writeConfig(_name[0] ? _name : nullptr, ssid, pass ? pass : "")) return false;
    strncpy(_ssid, ssid, sizeof(_ssid) - 1);
    _ssid[sizeof(_ssid) - 1] = '\0';
    strncpy(_pass, pass ? pass : "", sizeof(_pass) - 1);
    _pass[sizeof(_pass) - 1] = '\0';
    return true;
}

bool MiniR4WiFiRuntimeClass::setAPPassword(const char* pass)
{
    if (!pass) return false;
    const size_t len = strlen(pass);
    if (len == 0) {
        // Revert to the default password.
        _apPassCustom = false;
        strncpy(_apPass, AP_PASSWORD, sizeof(_apPass) - 1);
        _apPass[sizeof(_apPass) - 1] = '\0';
        return _writeConfig(_nameCustom ? _name : nullptr, _ssid, _pass);
    }
    if (len < MIN_AP_PASS_LEN || len > MAX_AP_PASS_LEN) return false;
    for (size_t i = 0; i < len; i++) {
        if (pass[i] < 0x20 || pass[i] > 0x7E) return false;
    }
    _apPassCustom = true;
    strncpy(_apPass, pass, sizeof(_apPass) - 1);
    _apPass[sizeof(_apPass) - 1] = '\0';
    return _writeConfig(_nameCustom ? _name : nullptr, _ssid, _pass);
}

bool MiniR4WiFiRuntimeClass::factoryReset()
{
    if (g_flash.erase(CONFIG_ADDR, DATAFLASH_BLOCK) != 0) return false;

    // A saved VM program is user data too, and leaving it behind makes the
    // reset actively misleading: the hub would come back "factory fresh" and
    // still auto-run yesterday's bytecode, which suppresses userLoop — so the
    // robot ignores its own program and looks broken, with the one command
    // the user reached for having apparently done nothing. Reset means reset.
    _forgetVmProgram();
    _vm.halt();
    _vmProgramSize = 0;
    _vmReceiving   = false;
    _vmPaused      = false;
    _vmStepOnce    = false;
    _vmBreakCount  = 0;

    // Full memset, same rationale as the constructor.
    memset(_name,  0, sizeof(_name));
    memset(_ssid,  0, sizeof(_ssid));
    memset(_pass,  0, sizeof(_pass));
    memset(_apPass, 0, sizeof(_apPass));
    _nameCustom = false;
    _macCache[0] = _macCache[1] = 0xFF;
    _apPassCustom = false;
    strncpy(_apPass, AP_PASSWORD, sizeof(_apPass) - 1);

    // Re-derive the default identity now instead of leaving _name blank until
    // the next boot rebuilds it in _fillIdentity(). Without this, a hub that
    // has been reset but not yet restarted reports an empty name — which the
    // USB setup panel showed as "?", making a successful reset look broken.
    // _mac4 still holds the real suffix in RAM; only the persisted copy went
    // away, and the next boot re-learns it.
    snprintf(_name, sizeof(_name), "MBR4-%s", _mac4);
    return true;
}

// --- Network bring-up -------------------------------------------------------

// Fallback-AP SSID: "<custom name>-<mac4>" when the user named the hub,
// "MBR4-<mac4>" otherwise. The MAC suffix is always kept so two students
// naming their robots identically can never create colliding networks.
// A rename takes effect on the SSID at the next power-cycle (restarting
// the AP mid-session would drop the very client that asked for it).
static void apSsidFor(const char* name, bool nameCustom, const char* mac4,
                      char* out, size_t cap)
{
    if (nameCustom && name[0]) {
        snprintf(out, cap, "%s-%s", name, mac4);   // max 24 + 1 + 4 = 29 < 32
    } else {
        snprintf(out, cap, "MBR4-%s", mac4);
    }
}

void MiniR4WiFiRuntimeClass::_fillIdentity()
{
    // WiFi.macAddress() answers all-zeros until the stack is up, so prefer
    // the cached copy from a previous boot; a direct query is only a bonus.
    uint8_t mac[6] = {0};
    WiFi.macAddress(mac);
    if (mac[4] || mac[5]) {
        _macCache[0] = mac[4];
        _macCache[1] = mac[5];
    }
    if (_macCache[0] == 0xFF && _macCache[1] == 0xFF) {
        snprintf(_mac4, sizeof(_mac4), "0000");
    } else {
        snprintf(_mac4, sizeof(_mac4), "%02X%02X", _macCache[0], _macCache[1]);
    }
    if (_name[0] == '\0') {
        snprintf(_name, sizeof(_name), "MBR4-%s", _mac4);
    }
}

// Called once the network is up (the MAC query is reliable from here on).
// First boot on a virgin hub or right after a factory reset: fixes the
// "MBR4-0000" placeholder identity and persists the real MAC to dataflash.
//
// MAY NOT RETURN — see the reboot below.
void MiniR4WiFiRuntimeClass::_refreshMacIdentity()
{
    uint8_t mac[6] = {0};
    WiFi.macAddress(mac);
    if (!mac[4] && !mac[5]) return;   // still not answering; keep placeholder

    char real4[5];
    snprintf(real4, sizeof(real4), "%02X%02X", mac[4], mac[5]);
    if (!strcmp(real4, _mac4)) return;   // identity already correct — the
                                         // overwhelmingly common case, and
                                         // the reason the reboot below is
                                         // once-in-a-hub's-life, not routine.

    _macCache[0] = mac[4];
    _macCache[1] = mac[5];
    memcpy(_mac4, real4, sizeof(_mac4));
    if (!_nameCustom) {
        snprintf(_name, sizeof(_name), "MBR4-%s", _mac4);
    }
    const bool persisted = _writeConfig(_nameCustom ? _name : nullptr, _ssid, _pass);

    if (_netMode != NET_AP) return;    // station mode: SSID is the router's

    // The AP is currently broadcasting the wrong name and has to change.
    //
    // We used to do that in place — WiFi.end(), settle, beginAP() again — and
    // then bind the UDP/TCP sockets on the freshly restarted netif a few
    // hundred milliseconds later. That is precisely the "bring sockets up
    // right after a modem mode transition" window that wedged a hub in the
    // field once before (fixed then by adding settle delays, commit a06f6a5):
    // the symptom is brutal to diagnose because the modem still answers ping
    // and still completes TCP handshakes while nothing reaches the sketch, so
    // the robot looks alive to the network and dead to the IDE. A user hit it
    // again on 2026-07-25 after a BTN_UP+BTN_DOWN factory reset — the one
    // gesture that guarantees this path runs, because it clears the cached MAC.
    //
    // Widening the delays would only make the race rarer. Since the MAC is now
    // safely in dataflash, a reset gets us the same outcome with no race at
    // all: the next boot reads the cached MAC, brings the AP up ONCE with the
    // correct SSID, and binds sockets on a netif that never changes under
    // them. Costs one extra ~3 s reboot, and only on the first boot after a
    // factory reset or on a hub that has never been powered up before.
    //
    // If the write failed we must NOT reset — we would come back to the same
    // placeholder identity and reset again, forever. Fall back to the old
    // in-place restart, which at least reaches the right SSID this session.
    if (persisted) {
        WIFIRT_TRACE(F("MAC learned; rebooting once for a clean AP bring-up"));
        delay(50);            // let the trace leave the UART
        NVIC_SystemReset();   // never returns
    }

    WIFIRT_TRACE(F("MAC persist FAILED; restarting AP in place"));
    WiFi.end();
    delay(500);   // same settle rationale as the failed-STA teardown
    char apName[33];
    apSsidFor(_name, _nameCustom, _mac4, apName, sizeof(apName));
    if (WiFi.beginAP(apName, _apPass) == WL_AP_LISTENING) {
        strncpy(_apSsid, apName, sizeof(_apSsid) - 1);
        _apSsid[sizeof(_apSsid) - 1] = '\0';
        delay(250);
    } else {
        _netMode = NET_DOWN;   // poll() retries; better down than misnamed
    }
}

void MiniR4WiFiRuntimeClass::_startNetwork(bool recovery)
{
    _lastStaRetryMs = millis();
    _netMode = NET_DOWN;

    if (_ssid[0] != '\0') {
        WIFIRT_TRACE(F("joining stored network..."));
        WiFi.begin(_ssid, _pass);
        const uint32_t t0 = millis();
        while (WiFi.status() != WL_CONNECTED
               && millis() - t0 < STA_JOIN_TIMEOUT_MS) {
            delay(250);
        }
        if (WiFi.status() == WL_CONNECTED) {
            _netMode = NET_STA;
        } else {
            WiFi.end();
            // Settle before re-configuring the modem: bringing the AP (and
            // its sockets) up immediately after a failed-STA teardown can
            // leave the bridge's socket layer wedged — the modem still
            // answers ping and accepts TCP, but nothing reaches the sketch.
            // Observed once on hardware (2026-07-22); a short pause between
            // mode transitions avoids the race.
            delay(500);
        }
    }

    if (_netMode == NET_DOWN) {
        // AP fallback: always available even with no credentials stored.
        char apName[33];
        apSsidFor(_name, _nameCustom, _mac4, apName, sizeof(apName));
        const int apResult = WiFi.beginAP(apName, _apPass);
        if (apResult == WL_AP_LISTENING) {
            _netMode = NET_AP;
            strncpy(_apSsid, apName, sizeof(_apSsid) - 1);
            _apSsid[sizeof(_apSsid) - 1] = '\0';
            delay(250);   // let the AP netif settle before binding sockets
        }
    }

    if (_netMode != NET_DOWN) {
        _refreshMacIdentity();   // may restart a misnamed AP once (first boot)
    }
    if (_netMode != NET_DOWN) {
        g_udp.begin(UDP_DISCOVERY_PORT);
        g_server.begin();
        WIFIRT_TRACE(F("network up"));
    } else if (!recovery) {
        WIFIRT_TRACE(F("network unavailable; will retry in poll()"));
    }
}

void MiniR4WiFiRuntimeClass::_recoveryLoop()
{
    char ipLine[24];
    const IPAddress ip = (_netMode == NET_AP) ? IPAddress(192, 168, 4, 1)
                                              : WiFi.localIP();
    snprintf(ipLine, sizeof(ipLine), "%u.%u.%u.%u", ip[0], ip[1], ip[2], ip[3]);
    _oledStatus("OTA MODE", ipLine);

    for (;;) {
        if (_netMode == NET_DOWN) {
            if (millis() - _lastStaRetryMs > STA_RETRY_INTERVAL_MS) {
                _startNetwork(true);
            }
        } else {
            _pollDiscovery();
            _pollCommands();
        }
        _pollSerial();   // recovery mode stays configurable over the cable
        delay(5);
    }
}

void MiniR4WiFiRuntimeClass::_oledStatus(const char* line1, const char* line2)
{
    MiniR4.OLED.clearDisplay();
    MiniR4.OLED.setTextSize(2);
    MiniR4.OLED.setTextColor(1);   // SSD1306 WHITE
    MiniR4.OLED.setCursor(5, 5);
    MiniR4.OLED.print(line1);
    MiniR4.OLED.setTextSize(1);
    MiniR4.OLED.setCursor(5, 26);
    MiniR4.OLED.print(line2);
    MiniR4.OLED.display();
}

// --- Discovery (UDP 47801) --------------------------------------------------

void MiniR4WiFiRuntimeClass::_pollDiscovery()
{
    const int packetSize = g_udp.parsePacket();
    if (packetSize <= 0) return;

    char req[64];
    const int n = g_udp.read(req, sizeof(req) - 1);
    if (n <= 0) return;
    req[n] = '\0';

    if (!strstr(req, "MBR4_DISCOVER")) return;

    const IPAddress ip = (_netMode == NET_AP) ? IPAddress(192, 168, 4, 1)
                                              : WiFi.localIP();
    char nameEsc[2 * MAX_NAME_LEN + 1];
    jsonEscape(_name, nameEsc, sizeof(nameEsc));

    char reply[192];
    const int len = snprintf(reply, sizeof(reply),
        "{\"t\":\"MBR4_HERE\",\"v\":1,\"name\":\"%s\",\"mac\":\"%s\","
        "\"ip\":\"%u.%u.%u.%u\",\"fw\":\"%s\",\"batt\":%d.%02d,\"mode\":\"%s\"}",
        nameEsc, _mac4, ip[0], ip[1], ip[2], ip[3],
        MINIR4_WIFI_RUNTIME_VERSION,
        (int)MiniR4.PWR.getBattVoltage(),
        (int)(MiniR4.PWR.getBattVoltage() * 100) % 100,
        _netMode == NET_AP ? "ap" : "sta");

    g_udp.beginPacket(g_udp.remoteIP(), g_udp.remotePort());
    g_udp.write((const uint8_t*)reply, len);
    g_udp.endPacket();
}

// --- Command server (TCP 47802, NDJSON) -------------------------------------

void MiniR4WiFiRuntimeClass::_pollCommands()
{
    // Only look for a new connection when there is no live client: every
    // g_server.available() call is a full SPI round-trip to the modem, and
    // doing it on every poll capped telemetry at ~9.4 Hz instead of 10.
    if (!g_client || !g_client.connected()) {
        WiFiClient incoming = g_server.available();
        if (incoming) {
            g_client   = incoming;
            _lineLen   = 0;
            _tmOn      = false;   // stream is opt-in per connection
        }
    }

    if (!g_client || !g_client.connected()) return;

    while (g_client.available()) {
        const int c = g_client.read();
        if (c < 0) break;
        if (c == '\n') {
            _lineBuf[_lineLen] = '\0';
            if (_lineLen > 0) _handleLine(_lineBuf);
            _lineLen = 0;
        } else if (c != '\r') {
            if (_lineLen + 1 < sizeof(_lineBuf)) {
                _lineBuf[_lineLen++] = (char)c;
            } else {
                _lineLen = 0;   // oversized line: drop it whole
            }
        }
    }
}

void MiniR4WiFiRuntimeClass::_sendJson(const char* fmt, ...)
{
    // A command that arrived over the cable is answered over the cable —
    // otherwise USB configuration would depend on a TCP client existing,
    // which is precisely what it is there to avoid.
    if (!_replyToSerial && (!g_client || !g_client.connected())) return;
    char buf[256];
    va_list ap;
    va_start(ap, fmt);
    const int len = vsnprintf(buf, sizeof(buf) - 2, fmt, ap);
    va_end(ap);
    if (len <= 0) return;
    buf[len]     = '\n';
    buf[len + 1] = '\0';
    if (_replyToSerial) Serial.write((const uint8_t*)buf, len + 1);
    else                g_client.write((const uint8_t*)buf, len + 1);
}

// --- USB serial config channel ----------------------------------------------

void MiniR4WiFiRuntimeClass::_pollSerial()
{
    // Bounded per call: a flood on the cable must not starve the network
    // poll or the VM. 64 bytes is several commands' worth at any baud we use.
    for (uint8_t budget = 0; budget < 64 && Serial.available() > 0; budget++) {
        const int c = Serial.read();
        if (c < 0) break;

        if (c == '\n' || c == '\r') {
            if (_serialLen == 0) continue;
            _serialBuf[_serialLen] = '\0';
            const uint16_t len = _serialLen;
            _serialLen = 0;
            // Only lines that look like our protocol are executed. The cable
            // is shared with whatever the student's own sketch reads and
            // writes, so anything that is not a JSON object is none of our
            // business and is dropped silently rather than nacked.
            if (_serialBuf[0] == '{' && len > 2) {
                _replyToSerial = true;
                _handleLine(_serialBuf);
                _replyToSerial = false;
            }
            continue;
        }

        if (_serialLen < sizeof(_serialBuf) - 1) {
            _serialBuf[_serialLen++] = (char)c;
        } else {
            _serialLen = 0;   // overlong line: drop it rather than truncate
        }                     // into a command that means something else
    }
}

void MiniR4WiFiRuntimeClass::_handleLine(char* line)
{
    char type[16];
    if (!jsonStr(line, "t", type, sizeof(type))) return;

    if (!strcmp(type, "ping")) {
        _sendJson("{\"t\":\"pong\",\"fw\":\"%s\",\"uptime\":%lu}",
                  MINIR4_WIFI_RUNTIME_VERSION, (unsigned long)millis());

    } else if (!strcmp(type, "info")) {
        const IPAddress ip = (_netMode == NET_AP) ? IPAddress(192, 168, 4, 1)
                                                  : WiFi.localIP();
        char nameEsc[2 * MAX_NAME_LEN + 1];
        char ssidEsc[2 * MAX_SSID_LEN + 1];
        jsonEscape(_name, nameEsc, sizeof(nameEsc));
        jsonEscape(_ssid, ssidEsc, sizeof(ssidEsc));
        // `ap` is the SSID on the air RIGHT NOW, which the IDE cannot derive:
        // a rename only reaches the SSID on the next power-cycle, so after a
        // rename or a factory reset the radio still carries the OLD name. That
        // gap is the single most common reason a user "cannot find the robot
        // anywhere" — they search for the name they just set. The panel
        // derives the post-restart name itself from `name` + `mac`, which
        // keeps this frame inside _sendJson's 256-byte budget.
        char apNowEsc[2 * 33];
        jsonEscape(_apSsid, apNowEsc, sizeof(apNowEsc));
        _sendJson("{\"t\":\"info\",\"name\":\"%s\",\"mac\":\"%s\",\"fw\":\"%s\","
                  "\"ip\":\"%u.%u.%u.%u\",\"mode\":\"%s\",\"ssid\":\"%s\","
                  "\"ap\":\"%s\",\"waiting\":%s,"
                  "\"batt\":%d.%02d,\"uptime\":%lu}",
                  nameEsc, _mac4, MINIR4_WIFI_RUNTIME_VERSION,
                  ip[0], ip[1], ip[2], ip[3],
                  _netMode == NET_AP ? "ap" : "sta", ssidEsc, apNowEsc,
                  _waitingStart ? "true" : "false",
                  (int)MiniR4.PWR.getBattVoltage(),
                  (int)(MiniR4.PWR.getBattVoltage() * 100) % 100,
                  (unsigned long)millis());

    } else if (!strcmp(type, "telemetry")) {
        bool on = false;
        jsonBool(line, "on", on);
        long hz = 10;
        jsonInt(line, "hz", hz);
        if (hz < 1)  hz = 1;
        if (hz > 50) hz = 50;
        _tmOn         = on;
        _tmIntervalMs = (uint16_t)(1000 / hz);
        _sendJson("{\"t\":\"ack\",\"cmd\":\"telemetry\",\"ok\":true}");

    } else if (!strcmp(type, "dht")) {
        // bit N of mask = poll DHT on D(N+1); same opt-in semantics as the
        // BLE branch's CMD_ENABLE_DHT (a failed read costs ~1 s, so ports
        // are only ever polled on explicit request from the IDE).
        long mask = 0;
        jsonInt(line, "mask", mask);
        _dhtEnabledMask = (uint8_t)(mask & 0x0F);
        _sendJson("{\"t\":\"ack\",\"cmd\":\"dht\",\"ok\":true}");

    } else if (!strcmp(type, "setname")) {
        char name[MAX_NAME_LEN + 1];
        const bool ok = jsonStr(line, "name", name, sizeof(name))
                        && setDeviceName(name);
        _sendJson("{\"t\":\"ack\",\"cmd\":\"setname\",\"ok\":%s}",
                  ok ? "true" : "false");

    } else if (!strcmp(type, "setwifi")) {
        char ssid[MAX_SSID_LEN + 1];
        char pass[MAX_PASS_LEN + 1];
        pass[0] = '\0';
        bool ok = jsonStr(line, "ssid", ssid, sizeof(ssid));
        jsonStr(line, "pass", pass, sizeof(pass));
        if (ok && ssid[0] == '\0') {
            // Empty SSID = forget the stored network: the hub goes back to
            // AP-only operation (and stops paying the 10 s STA timeout on
            // every boot for a network that no longer exists).
            ok = _writeConfig(_nameCustom ? _name : nullptr, "", "");
            if (ok) {
                _ssid[0] = '\0';
                _pass[0] = '\0';
            }
        } else {
            ok = ok && setCredentials(ssid, pass);
        }
        // Takes effect on next boot (or next STA retry when currently down);
        // switching networks mid-session would drop this very TCP client.
        _sendJson("{\"t\":\"ack\",\"cmd\":\"setwifi\",\"ok\":%s}",
                  ok ? "true" : "false");

    } else if (!strcmp(type, "setappass")) {
        // Empty pass = revert to the default "matrix2026". Takes effect on
        // the next boot; pair with {"t":"reboot"} to apply remotely.
        char pass[MAX_AP_PASS_LEN + 1];
        pass[0] = '\0';
        jsonStr(line, "pass", pass, sizeof(pass));
        const bool ok = setAPPassword(pass);
        _sendJson("{\"t\":\"ack\",\"cmd\":\"setappass\",\"ok\":%s}",
                  ok ? "true" : "false");

    } else if (!strcmp(type, "factory")) {
        const bool ok = factoryReset();
        _sendJson("{\"t\":\"ack\",\"cmd\":\"factory\",\"ok\":%s}",
                  ok ? "true" : "false");

    } else if (!strcmp(type, "reboot")) {
        _sendJson("{\"t\":\"ack\",\"cmd\":\"reboot\",\"ok\":true}");
        // Flush whichever transport the command came in on, or the ack dies
        // with the reset and the caller reports a failure for a reboot that
        // actually happened.
        if (_replyToSerial) Serial.flush();
        else                g_client.flush();
        delay(150);   // let the ack leave the modem / UART
        NVIC_SystemReset();

    } else if (!strcmp(type, "start")) {
        // Releases waitForStart(). Acked with whether the robot was actually
        // parked, so a teacher starting a whole class can tell which robots
        // were waiting and which were already running.
        const bool wasWaiting = _waitingStart;
        _startRequested = true;
        _sendJson("{\"t\":\"ack\",\"cmd\":\"start\",\"ok\":true,\"waiting\":%s}",
                  wasWaiting ? "true" : "false");

    } else if (!strcmp(type, "echo")) {
        // R3 helper: server logs whatever string the client passed.
        // Useful for validating the log pipeline end-to-end and for
        // command-line diagnostic tools ("does my hub see me?").
        char msg[200];
        if (jsonStr(line, "s", msg, sizeof(msg))) log(msg);
        _sendJson("{\"t\":\"ack\",\"cmd\":\"echo\",\"ok\":true}");

    } else if (!strcmp(type, "vm_start")) {
        long size = 0;
        jsonInt(line, "size", size);
        _handleVmStart(size);

    } else if (!strcmp(type, "vm_chunk")) {
        // Point at the raw base64 chunk inside _lineBuf; _handleVmChunk
        // extracts and decodes it. Using jsonStr into a scratch would
        // copy the payload twice for no reason.
        char chunk[160];
        if (!jsonStr(line, "d", chunk, sizeof(chunk))) {
            _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_chunk\",\"ok\":false,\"err\":\"parse\"}");
        } else {
            _handleVmChunk(chunk);
        }

    } else if (!strcmp(type, "vm_end")) {
        // "save":true also writes the program to dataflash so it survives a
        // power cycle and auto-runs at boot.
        bool save = false;
        jsonBool(line, "save", save);
        _handleVmEnd(save);
        // Convenience: if the client passed run:true, kick execution now.
        bool autoRun = false;
        jsonBool(line, "run", autoRun);
        if (autoRun && _vmProgramSize) _handleVmRun();

    } else if (!strcmp(type, "vm_run")) {
        _handleVmRun();

    } else if (!strcmp(type, "vm_stop")) {
        _vm.halt();
        _vmPaused   = false;
        _vmStepOnce = false;
        _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_stop\",\"ok\":true}");
        log("VM stopped by user");

    } else if (!strcmp(type, "vm_erase")) {
        _vm.halt();
        _vmProgramSize = 0;
        _vmRxOffset    = 0;
        _vmReceiving   = false;
        _vmPaused      = false;
        _vmStepOnce    = false;
        _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_erase\",\"ok\":true}");

    } else if (!strcmp(type, "vm_save")) {
        // Save whatever is currently loaded (lets the IDE offer "keep this
        // program on the robot" after the fact, not only at upload time).
        const bool ok = _saveVmProgram();
        _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_save\",\"ok\":%s,\"size\":%u}",
                  ok ? "true" : "false", _vmProgramSize);

    } else if (!strcmp(type, "vm_forget")) {
        const bool ok = _forgetVmProgram();
        _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_forget\",\"ok\":%s}",
                  ok ? "true" : "false");

    } else if (!strcmp(type, "vm_info")) {
        _sendJson("{\"t\":\"vm_info\",\"size\":%u,\"stored\":%s,\"running\":%s,"
                  "\"paused\":%s,\"pc\":%u,\"bp\":%u}",
                  _vmProgramSize,
                  _vmStored        ? "true" : "false",
                  _vm.isRunning()  ? "true" : "false",
                  _vmPaused        ? "true" : "false",
                  (unsigned)_vm.pc(), (unsigned)_vmBreakCount);

    // --- Live block debug (R2) ---------------------------------------------
    } else if (!strcmp(type, "vm_debug")) {
        bool on = false;
        jsonBool(line, "on", on);
        long hz = 0;
        if (jsonInt(line, "hz", hz) && hz > 0) {
            if (hz > 20) hz = 20;   // beyond this the modem write dominates
            _vmPcIntervalMs = (uint16_t)(1000L / hz);
        }
        _vmDebugOn    = on;
        _vmPcLastSent = 0xFFFF;     // force the next frame through
        _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_debug\",\"ok\":true,\"ms\":%u}",
                  _vmPcIntervalMs);
        if (on) _sendPcFrame(true);

    } else if (!strcmp(type, "vm_pause")) {
        _vmPaused   = true;
        _vmStepOnce = false;
        _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_pause\",\"ok\":true}");
        _sendPcFrame(true);

    } else if (!strcmp(type, "vm_resume")) {
        _vmPaused   = false;
        _vmStepOnce = false;
        _vmBpArmed  = false;   // don't re-trigger the breakpoint we sit on
        _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_resume\",\"ok\":true}");

    } else if (!strcmp(type, "vm_step")) {
        _vmStepOnce = true;
        _vmBpArmed  = false;
        _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_step\",\"ok\":true}");

    } else if (!strcmp(type, "vm_break")) {
        // {"add":pc} | {"del":pc} | {"clear":true}
        bool clear = false;
        long pc = 0;
        if (jsonBool(line, "clear", clear) && clear) {
            _vmBreakCount = 0;
            _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_break\",\"ok\":true,\"n\":0}");
        } else if (jsonInt(line, "add", pc) && pc >= 0 && pc <= 0xFFFE) {
            bool ok = true;
            if (!_vmIsBreakpoint((uint16_t)pc)) {
                if (_vmBreakCount < VM_MAX_BREAKPOINTS) {
                    _vmBreak[_vmBreakCount++] = (uint16_t)pc;
                } else {
                    ok = false;   // full — the IDE surfaces the limit
                }
            }
            _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_break\",\"ok\":%s,\"n\":%u}",
                      ok ? "true" : "false", (unsigned)_vmBreakCount);
        } else if (jsonInt(line, "del", pc)) {
            for (uint8_t i = 0; i < _vmBreakCount; i++) {
                if (_vmBreak[i] == (uint16_t)pc) {
                    _vmBreak[i] = _vmBreak[--_vmBreakCount];   // order is free
                    break;
                }
            }
            _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_break\",\"ok\":true,\"n\":%u}",
                      (unsigned)_vmBreakCount);
        } else {
            _sendJson("{\"t\":\"ack\",\"cmd\":\"vm_break\",\"ok\":false,\"err\":\"args\"}");
        }

    } else if (!strcmp(type, "vm_vars")) {
        _sendVarsFrame();

    } else if (!strcmp(type, "ota")) {
        // OTA is a network operation by definition (the modem fetches the
        // image over HTTP). Refuse it clearly over the cable rather than
        // letting it fail deep inside OTAUpdate with a cryptic code — USB
        // users have arduino-cli, which is the better tool anyway.
        if (_replyToSerial || _netMode == NET_DOWN) {
            _sendJson("{\"t\":\"ota_status\",\"phase\":\"error\",\"code\":-2,"
                      "\"detail\":\"needs network\"}");
            return;
        }
        char url[160];
        if (!jsonStr(line, "url", url, sizeof(url))) {
            _sendJson("{\"t\":\"ota_status\",\"phase\":\"error\",\"code\":-1,"
                      "\"detail\":\"missing url\"}");
            return;
        }
        _handleOta(url);

    } else {
        _sendJson("{\"t\":\"ack\",\"cmd\":\"?\",\"ok\":false}");
    }
}

// --- OTA --------------------------------------------------------------------

void MiniR4WiFiRuntimeClass::_handleOta(const char* url)
{
    _tmOn = false;   // keep the socket clean for status frames

    int ret = g_ota.begin("/update.bin");
    if (ret != OTAUpdate::OTA_ERROR_NONE) {
        _sendJson("{\"t\":\"ota_status\",\"phase\":\"error\",\"code\":%d,"
                  "\"detail\":\"begin\"}", ret);
        return;
    }

    _sendJson("{\"t\":\"ota_status\",\"phase\":\"download\",\"pct\":0}");
    _oledStatus("WiFi OTA", "downloading...");

    // The ESP32-S3 modem downloads the file to its own flash; the RA4M1
    // just polls progress. startDownload needs modem firmware >= 0.5.0
    // (checked during Fase 0 hardware validation).
    const int total = g_ota.startDownload(url, "/update.bin");
    if (total <= 0) {
        _sendJson("{\"t\":\"ota_status\",\"phase\":\"error\",\"code\":%d,"
                  "\"detail\":\"download start\"}", total);
        _oledStatus("WiFi OTA", "download error");
        return;
    }

    int downloaded = 0;
    int lastPct    = -1;
    while (downloaded < total) {
        downloaded = g_ota.downloadProgress();
        if (downloaded < 0) {
            _sendJson("{\"t\":\"ota_status\",\"phase\":\"error\",\"code\":%d,"
                      "\"detail\":\"download\"}", downloaded);
            _oledStatus("WiFi OTA", "download error");
            return;
        }
        const int pct = (int)(((int64_t)downloaded * 100) / total);
        if (pct != lastPct) {
            lastPct = pct;
            _sendJson("{\"t\":\"ota_status\",\"phase\":\"download\",\"pct\":%d}", pct);
        }
        delay(100);
    }

    _sendJson("{\"t\":\"ota_status\",\"phase\":\"verify\",\"pct\":0}");
    _oledStatus("WiFi OTA", "verifying...");
    ret = g_ota.verify();
    if (ret != OTAUpdate::OTA_ERROR_NONE) {
        _sendJson("{\"t\":\"ota_status\",\"phase\":\"error\",\"code\":%d,"
                  "\"detail\":\"verify\"}", ret);
        _oledStatus("WiFi OTA", "verify error");
        return;
    }

    // Point of no return: update() reflashes the RA4M1 and reboots into the
    // new sketch. Flush the status frame first so the IDE sees "apply".
    _sendJson("{\"t\":\"ota_status\",\"phase\":\"apply\",\"pct\":0}");
    g_client.flush();
    _oledStatus("WiFi OTA", "flashing...");
    delay(150);   // let the TCP segment leave the modem before reflash

    ret = g_ota.update("/update.bin");

    // Only reached on failure.
    _sendJson("{\"t\":\"ota_status\",\"phase\":\"error\",\"code\":%d,"
              "\"detail\":\"apply\"}", ret);
    _oledStatus("WiFi OTA", "apply error");
}

// --- Telemetry --------------------------------------------------------------

void MiniR4WiFiRuntimeClass::_pollTelemetry()
{
    if (!_tmOn || !g_client || !g_client.connected()) return;
    if (millis() - _tmLastMs < _tmIntervalMs) return;
    // Catch-up scheduling: advance by the interval, not to "now", so the
    // ~10-15 ms of frame building doesn't erode the rate (measured 8.6 Hz
    // instead of 10 without this). Resync if we fell hopelessly behind
    // (e.g. an OTA download monopolised the loop).
    _tmLastMs += _tmIntervalMs;
    if (millis() - _tmLastMs > 1000) _tmLastMs = millis();

    // ----- frame body: byte-compatible with the BLE branch (see file docs) --
    const uint16_t battMv = (uint16_t)(MiniR4.PWR.getBattVoltage() * 100.0f);
    const int16_t  roll   = (int16_t)(MiniR4.Motion.getEuler(MiniR4Motion::AxisType::Roll)  * 100.0);
    const int16_t  pitch  = (int16_t)(MiniR4.Motion.getEuler(MiniR4Motion::AxisType::Pitch) * 100.0);
    const int16_t  yaw    = (int16_t)(MiniR4.Motion.getEuler(MiniR4Motion::AxisType::Yaw)   * 100.0);
    const uint8_t  btns   = (uint8_t)((MiniR4.BTN_DOWN.getState() ? 1 : 0)
                                    | (MiniR4.BTN_UP.getState()   ? 2 : 0));
    const uint32_t upSecs = (uint32_t)(millis() / 1000UL);
    const int32_t  m1     = (int32_t)MiniR4.M1.getDegrees();
    const int32_t  m2     = (int32_t)MiniR4.M2.getDegrees();
    const int32_t  m3     = (int32_t)MiniR4.M3.getDegrees();
    const int32_t  m4     = (int32_t)MiniR4.M4.getDegrees();
    const uint16_t a0 = (uint16_t)analogRead(A0);
    const uint16_t a1 = (uint16_t)analogRead(A1);
    const uint16_t a2 = (uint16_t)analogRead(A2);
    const uint16_t a3 = (uint16_t)analogRead(A3);
    const uint16_t a4 = (uint16_t)analogRead(A4);
    const uint16_t a5 = (uint16_t)analogRead(A5);

    // D-port pins only (2,3,4,5,10,11,12,13); INPUT_PULLUP once so floating
    // switches read stable — same rationale as the BLE branch.
    const uint8_t pins[8] = {2, 3, 4, 5, 10, 11, 12, 13};
    static bool s_pinsPulled = false;
    if (!s_pinsPulled) {
        for (uint8_t i = 0; i < 8; ++i) pinMode(pins[i], INPUT_PULLUP);
        s_pinsPulled = true;
    }
    uint16_t dbits = 0;
    for (uint8_t i = 0; i < 8; ++i) {
        if (digitalRead(pins[i])) dbits |= (uint16_t)(1u << pins[i]);
    }

    // Lazy one-shot probe of MXLaserV2/MXColorV3 on all 4 I2C channels.
    static bool s_i2cInited = false;
    static bool s_laserReady[4] = { false, false, false, false };
    static bool s_colorReady[4] = { false, false, false, false };
    if (!s_i2cInited) {
        s_i2cInited = true;
        if (MiniR4.I2C1.MXLaserV2.begin()) {
            MiniR4.I2C1.MXLaserV2.setTimeout(50);
            MiniR4.I2C1.MXLaserV2.startContinuous(50);
            s_laserReady[0] = true;
        }
        if (MiniR4.I2C2.MXLaserV2.begin()) {
            MiniR4.I2C2.MXLaserV2.setTimeout(50);
            MiniR4.I2C2.MXLaserV2.startContinuous(50);
            s_laserReady[1] = true;
        }
        if (MiniR4.I2C3.MXLaserV2.begin()) {
            MiniR4.I2C3.MXLaserV2.setTimeout(50);
            MiniR4.I2C3.MXLaserV2.startContinuous(50);
            s_laserReady[2] = true;
        }
        if (MiniR4.I2C4.MXLaserV2.begin()) {
            MiniR4.I2C4.MXLaserV2.setTimeout(50);
            MiniR4.I2C4.MXLaserV2.startContinuous(50);
            s_laserReady[3] = true;
        }
        if (MiniR4.I2C1.MXColorV3.begin()) s_colorReady[0] = true;
        if (MiniR4.I2C2.MXColorV3.begin()) s_colorReady[1] = true;
        if (MiniR4.I2C3.MXColorV3.begin()) s_colorReady[2] = true;
        if (MiniR4.I2C4.MXColorV3.begin()) s_colorReady[3] = true;
    }
    const uint16_t laser1 = s_laserReady[0]
        ? MiniR4.I2C1.MXLaserV2.getDistance() : (uint16_t)0xFFFF;
    const uint16_t laser2 = s_laserReady[1]
        ? MiniR4.I2C2.MXLaserV2.getDistance() : (uint16_t)0xFFFF;
    const uint16_t laser3 = s_laserReady[2]
        ? MiniR4.I2C3.MXLaserV2.getDistance() : (uint16_t)0xFFFF;
    const uint16_t laser4 = s_laserReady[3]
        ? MiniR4.I2C4.MXLaserV2.getDistance() : (uint16_t)0xFFFF;
    uint8_t color_r[4] = { 0, 0, 0, 0 };
    uint8_t color_g[4] = { 0, 0, 0, 0 };
    uint8_t color_b[4] = { 0, 0, 0, 0 };
    int8_t  color_id[4] = { -1, -1, -1, -1 };
    if (s_colorReady[0]) {
        color_r[0]  = (uint8_t)MiniR4.I2C1.MXColorV3.getR();
        color_g[0]  = (uint8_t)MiniR4.I2C1.MXColorV3.getG();
        color_b[0]  = (uint8_t)MiniR4.I2C1.MXColorV3.getB();
        color_id[0] = (int8_t) MiniR4.I2C1.MXColorV3.getColorID();
    }
    if (s_colorReady[1]) {
        color_r[1]  = (uint8_t)MiniR4.I2C2.MXColorV3.getR();
        color_g[1]  = (uint8_t)MiniR4.I2C2.MXColorV3.getG();
        color_b[1]  = (uint8_t)MiniR4.I2C2.MXColorV3.getB();
        color_id[1] = (int8_t) MiniR4.I2C2.MXColorV3.getColorID();
    }
    if (s_colorReady[2]) {
        color_r[2]  = (uint8_t)MiniR4.I2C3.MXColorV3.getR();
        color_g[2]  = (uint8_t)MiniR4.I2C3.MXColorV3.getG();
        color_b[2]  = (uint8_t)MiniR4.I2C3.MXColorV3.getB();
        color_id[2] = (int8_t) MiniR4.I2C3.MXColorV3.getColorID();
    }
    if (s_colorReady[3]) {
        color_r[3]  = (uint8_t)MiniR4.I2C4.MXColorV3.getR();
        color_g[3]  = (uint8_t)MiniR4.I2C4.MXColorV3.getG();
        color_b[3]  = (uint8_t)MiniR4.I2C4.MXColorV3.getB();
        color_id[3] = (int8_t) MiniR4.I2C4.MXColorV3.getColorID();
    }

    // DHT11 on user-enabled D-ports; opt-in + fail-latch + 2 s round-robin,
    // identical policy to the BLE branch.
    static bool     s_dhtDelaySet = false;
    static int8_t   s_dhtTemp[4]  = { 127, 127, 127, 127 };
    static uint8_t  s_dhtHum[4]   = { 255, 255, 255, 255 };
    static bool     s_dhtFailed[4] = { false, false, false, false };
    static uint32_t s_dhtLastMs   = 0;
    static uint8_t  s_dhtIdx      = 0;
    if (!s_dhtDelaySet) {
        MiniR4.D1.MXDHT.setDelay(0);
        MiniR4.D2.MXDHT.setDelay(0);
        MiniR4.D3.MXDHT.setDelay(0);
        MiniR4.D4.MXDHT.setDelay(0);
        s_dhtDelaySet = true;
    }
    const uint8_t newlyEnabled = (uint8_t)(_dhtEnabledMask & ~_dhtLastAppliedMask);
    if (newlyEnabled) {
        for (uint8_t p = 0; p < 4; ++p) {
            if (newlyEnabled & (1u << p)) {
                s_dhtFailed[p] = false;
                s_dhtTemp[p]   = 127;
                s_dhtHum[p]    = 255;
            }
        }
    }
    const uint8_t nowDisabled = (uint8_t)(~_dhtEnabledMask & _dhtLastAppliedMask);
    if (nowDisabled) {
        for (uint8_t p = 0; p < 4; ++p) {
            if (nowDisabled & (1u << p)) {
                s_dhtTemp[p] = 127;
                s_dhtHum[p]  = 255;
            }
        }
    }
    _dhtLastAppliedMask = _dhtEnabledMask;
    if (_dhtEnabledMask && (millis() - s_dhtLastMs > 2000)) {
        for (uint8_t i = 0; i < 4; ++i) {
            const uint8_t p = (uint8_t)((s_dhtIdx + 1u + i) % 4u);
            const bool wanted = ((_dhtEnabledMask >> p) & 1u) && !s_dhtFailed[p];
            if (!wanted) continue;
            float t = 0.0f;
            int   h = 0;
            int   err = 0;
            switch (p) {
                case 0: err = MiniR4.D1.MXDHT.readTemperatureHumidity(t, h); break;
                case 1: err = MiniR4.D2.MXDHT.readTemperatureHumidity(t, h); break;
                case 2: err = MiniR4.D3.MXDHT.readTemperatureHumidity(t, h); break;
                case 3: err = MiniR4.D4.MXDHT.readTemperatureHumidity(t, h); break;
            }
            if (err == 0) {
                s_dhtTemp[p] = (int8_t)t;
                s_dhtHum[p]  = (uint8_t)h;
            } else {
                s_dhtFailed[p] = true;
                s_dhtTemp[p]   = 127;
                s_dhtHum[p]    = 255;
            }
            s_dhtIdx    = p;
            s_dhtLastMs = millis();
            break;
        }
    }

    // VM fields (bytes 3..8): populated with real state now that the R2
    // branch hosts the bytecode VM. The IDE parser reads these back in
    // the "Estado > Programa" section of the HUD.
    const uint16_t vmPc = _vm.pc();
    uint8_t buf[TELEMETRY_BYTES] = {
        RSP_TELEMETRY,
        (uint8_t)(battMv & 0xFF), (uint8_t)((battMv >> 8) & 0xFF),
        (uint8_t)(_vm.isRunning() ? 1 : 0),
        (uint8_t)_vm.lastError(),
        (uint8_t)(vmPc & 0xFF), (uint8_t)((vmPc >> 8) & 0xFF),
        (uint8_t)(_vmProgramSize & 0xFF), (uint8_t)((_vmProgramSize >> 8) & 0xFF),
        (uint8_t)(roll & 0xFF),  (uint8_t)((roll  >> 8) & 0xFF),
        (uint8_t)(pitch & 0xFF), (uint8_t)((pitch >> 8) & 0xFF),
        (uint8_t)(yaw & 0xFF),   (uint8_t)((yaw   >> 8) & 0xFF),
        btns,
        (uint8_t)(upSecs & 0xFF),         (uint8_t)((upSecs >> 8)  & 0xFF),
        (uint8_t)((upSecs >> 16) & 0xFF), (uint8_t)((upSecs >> 24) & 0xFF),
        (uint8_t)(m1 & 0xFF), (uint8_t)((m1 >> 8) & 0xFF), (uint8_t)((m1 >> 16) & 0xFF), (uint8_t)((m1 >> 24) & 0xFF),
        (uint8_t)(m2 & 0xFF), (uint8_t)((m2 >> 8) & 0xFF), (uint8_t)((m2 >> 16) & 0xFF), (uint8_t)((m2 >> 24) & 0xFF),
        (uint8_t)(m3 & 0xFF), (uint8_t)((m3 >> 8) & 0xFF), (uint8_t)((m3 >> 16) & 0xFF), (uint8_t)((m3 >> 24) & 0xFF),
        (uint8_t)(m4 & 0xFF), (uint8_t)((m4 >> 8) & 0xFF), (uint8_t)((m4 >> 16) & 0xFF), (uint8_t)((m4 >> 24) & 0xFF),
        (uint8_t)(a0 & 0xFF), (uint8_t)((a0 >> 8) & 0xFF),
        (uint8_t)(a1 & 0xFF), (uint8_t)((a1 >> 8) & 0xFF),
        (uint8_t)(a2 & 0xFF), (uint8_t)((a2 >> 8) & 0xFF),
        (uint8_t)(a3 & 0xFF), (uint8_t)((a3 >> 8) & 0xFF),
        (uint8_t)(a4 & 0xFF), (uint8_t)((a4 >> 8) & 0xFF),
        (uint8_t)(a5 & 0xFF), (uint8_t)((a5 >> 8) & 0xFF),
        (uint8_t)(dbits & 0xFF), (uint8_t)((dbits >> 8) & 0xFF),
        (uint8_t)(laser1 & 0xFF), (uint8_t)((laser1 >> 8) & 0xFF),
        (uint8_t)(laser2 & 0xFF), (uint8_t)((laser2 >> 8) & 0xFF),
        (uint8_t)s_dhtTemp[0], s_dhtHum[0],
        (uint8_t)s_dhtTemp[1], s_dhtHum[1],
        (uint8_t)s_dhtTemp[2], s_dhtHum[2],
        (uint8_t)s_dhtTemp[3], s_dhtHum[3],
        color_r[0], color_g[0], color_b[0], (uint8_t)color_id[0],
        color_r[1], color_g[1], color_b[1], (uint8_t)color_id[1],
        (uint8_t)(laser3 & 0xFF), (uint8_t)((laser3 >> 8) & 0xFF),
        (uint8_t)(laser4 & 0xFF), (uint8_t)((laser4 >> 8) & 0xFF),
        color_r[2], color_g[2], color_b[2], (uint8_t)color_id[2],
        color_r[3], color_g[3], color_b[3], (uint8_t)color_id[3],
    };

    // NDJSON envelope: the raw 82-byte blob travels base64-encoded so the
    // IDE reuses its existing binary frame parser after a single decode.
    char b64[((TELEMETRY_BYTES + 2) / 3) * 4 + 1];
    base64Encode(buf, sizeof(buf), b64);
    _sendJson("{\"t\":\"tm\",\"d\":\"%s\"}", b64);
}

// --- Dataflash persistence --------------------------------------------------
// Raw DataFlashBlockDevice access (same driver + workarounds as the BLE
// branch: erase-before-program, alignas(4) buffers, whole-record rewrite).

bool MiniR4WiFiRuntimeClass::_readConfig(char* nameOut, char* ssidOut, char* passOut)
{
    nameOut[0] = ssidOut[0] = passOut[0] = '\0';

    alignas(4) uint8_t buf[CONFIG_SIZE];
    if (g_flash.read(buf, CONFIG_ADDR, CONFIG_SIZE) != 0) return false;
    if (memcmp(buf, CONFIG_MAGIC, 4) != 0) return false;

    const uint8_t nameLen = buf[CFG_OFF_NAMELEN];
    if (nameLen >= 1 && nameLen <= MAX_NAME_LEN) {
        memcpy(nameOut, buf + CFG_OFF_NAME, nameLen);
        nameOut[nameLen] = '\0';
        _nameCustom = true;
    }
    if (buf[CFG_OFF_MAC] != 0xFF || buf[CFG_OFF_MAC + 1] != 0xFF) {
        _macCache[0] = buf[CFG_OFF_MAC];
        _macCache[1] = buf[CFG_OFF_MAC + 1];
    }
    const uint8_t apLen = buf[CFG_OFF_APPASSLEN];
    if (apLen >= MIN_AP_PASS_LEN && apLen <= MAX_AP_PASS_LEN) {
        memcpy(_apPass, buf + CFG_OFF_APPASS, apLen);
        _apPass[apLen] = '\0';
        _apPassCustom = true;
    }
    const uint8_t ssidLen = buf[CFG_OFF_SSIDLEN];
    if (ssidLen >= 1 && ssidLen <= MAX_SSID_LEN) {
        memcpy(ssidOut, buf + CFG_OFF_SSID, ssidLen);
        ssidOut[ssidLen] = '\0';
        const uint8_t passLen = buf[CFG_OFF_PASSLEN];
        if (passLen <= MAX_PASS_LEN) {   // 0 is valid (open network)
            memcpy(passOut, buf + CFG_OFF_PASS, passLen);
            passOut[passLen] = '\0';
        }
    }
    return true;
}

bool MiniR4WiFiRuntimeClass::_writeConfig(const char* name, const char* ssid, const char* pass)
{
    alignas(4) uint8_t buf[CONFIG_SIZE];
    memset(buf, 0xFF, sizeof(buf));
    memcpy(buf, CONFIG_MAGIC, 4);

    if (name && name[0]) {
        const size_t len = strlen(name);
        if (len > MAX_NAME_LEN) return false;
        buf[CFG_OFF_NAMELEN] = (uint8_t)len;
        memcpy(buf + CFG_OFF_NAME, name, len);
    }
    buf[CFG_OFF_MAC]     = _macCache[0];
    buf[CFG_OFF_MAC + 1] = _macCache[1];
    if (_apPassCustom) {
        const size_t apLen = strlen(_apPass);
        buf[CFG_OFF_APPASSLEN] = (uint8_t)apLen;
        memcpy(buf + CFG_OFF_APPASS, _apPass, apLen);
    }
    if (ssid && ssid[0]) {
        const size_t slen = strlen(ssid);
        const size_t plen = pass ? strlen(pass) : 0;
        if (slen > MAX_SSID_LEN || plen > MAX_PASS_LEN) return false;
        buf[CFG_OFF_SSIDLEN] = (uint8_t)slen;
        memcpy(buf + CFG_OFF_SSID, ssid, slen);
        buf[CFG_OFF_PASSLEN] = (uint8_t)plen;
        if (plen) memcpy(buf + CFG_OFF_PASS, pass, plen);
    }

    if (g_flash.erase(CONFIG_ADDR, DATAFLASH_BLOCK) != 0) return false;
    return (g_flash.program(buf, CONFIG_ADDR, CONFIG_SIZE) == 0);
}
