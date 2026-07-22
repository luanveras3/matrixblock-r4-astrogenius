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
constexpr const char* AP_PASSWORD     = "matrix2026";
constexpr uint32_t STA_JOIN_TIMEOUT_MS  = 10000;  ///< per begin() attempt
constexpr uint32_t STA_RETRY_INTERVAL_MS = 30000; ///< re-try cadence in poll()

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
void jsonEscape(const char* in, char* out, size_t cap)
{
    size_t n = 0;
    for (; *in && n + 2 < cap; in++) {
        if (*in == '"' || *in == '\\') {
            if (n + 3 >= cap) break;
            out[n++] = '\\';
        }
        out[n++] = *in;
    }
    out[n] = '\0';
}

// --- base64 (for the binary telemetry blob inside NDJSON) -------------------

const char B64_ALPHABET[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

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
    , _lineLen(0)
    , _tmOn(false)
    , _tmIntervalMs(100)
    , _tmLastMs(0)
    , _dhtEnabledMask(0)
    , _dhtLastAppliedMask(0)
{
    _name[0] = '\0';
    _mac4[0] = '\0';
    _ssid[0] = '\0';
    _pass[0] = '\0';
    _macCache[0] = _macCache[1] = 0xFF;
    strncpy(_apPass, AP_PASSWORD, sizeof(_apPass) - 1);
    _apPass[sizeof(_apPass) - 1] = '\0';
    _apPassCustom = false;
}

// --- Public API -------------------------------------------------------------

void MiniR4WiFiRuntimeClass::begin()
{
    if (_begun) return;
    _begun = true;

    if (WiFi.status() == WL_NO_MODULE) {
        WIFIRT_TRACE(F("no WiFi module; runtime disabled"));
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

    // Recovery gesture: BTN_UP held at boot => network-only loop, the user
    // sketch never runs. Guarantees a hub with a crashing/blocking sketch
    // can always be re-flashed over the air (manual §2.4 — mandatory).
    const bool recovery = MiniR4.BTN_UP.getState() && !MiniR4.BTN_DOWN.getState();

    _startNetwork(recovery);

    if (recovery) {
        _recoveryLoop();   // never returns
    }
}

void MiniR4WiFiRuntimeClass::poll()
{
    if (!_begun) return;

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
    _name[0] = '\0';
    _nameCustom = false;
    _ssid[0] = '\0';
    _pass[0] = '\0';
    _macCache[0] = _macCache[1] = 0xFF;
    _apPassCustom = false;
    strncpy(_apPass, AP_PASSWORD, sizeof(_apPass) - 1);
    _apPass[sizeof(_apPass) - 1] = '\0';
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
// First boot on a hub: fixes the "MBR4-0000" placeholder identity, persists
// the MAC to dataflash, and — if the fallback AP is already broadcasting the
// wrong name — restarts it once with the right one.
void MiniR4WiFiRuntimeClass::_refreshMacIdentity()
{
    uint8_t mac[6] = {0};
    WiFi.macAddress(mac);
    if (!mac[4] && !mac[5]) return;   // still not answering; keep placeholder

    char real4[5];
    snprintf(real4, sizeof(real4), "%02X%02X", mac[4], mac[5]);
    if (!strcmp(real4, _mac4)) return;   // identity already correct

    _macCache[0] = mac[4];
    _macCache[1] = mac[5];
    memcpy(_mac4, real4, sizeof(_mac4));
    if (!_nameCustom) {
        snprintf(_name, sizeof(_name), "MBR4-%s", _mac4);
    }
    _writeConfig(_nameCustom ? _name : nullptr, _ssid, _pass);

    if (_netMode == NET_AP) {
        WIFIRT_TRACE(F("restarting AP with real MAC suffix"));
        WiFi.end();
        delay(500);   // same settle rationale as the failed-STA teardown
        char apName[33];
        apSsidFor(_name, _nameCustom, _mac4, apName, sizeof(apName));
        if (WiFi.beginAP(apName, _apPass) == WL_AP_LISTENING) {
            delay(250);
        } else {
            _netMode = NET_DOWN;   // poll() retries; better down than misnamed
        }
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
        WIFIRT_TRACE(F("starting fallback AP"));
        if (WiFi.beginAP(apName, _apPass) == WL_AP_LISTENING) {
            _netMode = NET_AP;
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
    if (!g_client || !g_client.connected()) return;
    char buf[256];
    va_list ap;
    va_start(ap, fmt);
    const int len = vsnprintf(buf, sizeof(buf) - 2, fmt, ap);
    va_end(ap);
    if (len <= 0) return;
    buf[len]     = '\n';
    buf[len + 1] = '\0';
    g_client.write((const uint8_t*)buf, len + 1);
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
        _sendJson("{\"t\":\"info\",\"name\":\"%s\",\"mac\":\"%s\",\"fw\":\"%s\","
                  "\"ip\":\"%u.%u.%u.%u\",\"mode\":\"%s\",\"ssid\":\"%s\","
                  "\"batt\":%d.%02d,\"uptime\":%lu}",
                  nameEsc, _mac4, MINIR4_WIFI_RUNTIME_VERSION,
                  ip[0], ip[1], ip[2], ip[3],
                  _netMode == NET_AP ? "ap" : "sta", ssidEsc,
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
        g_client.flush();
        delay(150);   // let the ack leave the modem
        NVIC_SystemReset();

    } else if (!strcmp(type, "ota")) {
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

    uint8_t buf[TELEMETRY_BYTES] = {
        RSP_TELEMETRY,
        (uint8_t)(battMv & 0xFF), (uint8_t)((battMv >> 8) & 0xFF),
        0,                              // VM running flag — no VM on this branch
        0,                              // VM last error
        0, 0,                           // VM pc
        0, 0,                           // VM program size
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
