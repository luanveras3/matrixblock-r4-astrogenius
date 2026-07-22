/**
 * @file MiniR4WiFiRuntime.h
 * @brief Always-on WiFi TCP runtime for the Matrix Mini R4 (OTA branch).
 *
 * Provides `WiFiRuntime.begin()` / `WiFiRuntime.poll()` so any user sketch
 * becomes a wireless target for the MATRIXblock IDE: discovery over UDP,
 * a newline-delimited-JSON (NDJSON) command server over TCP, telemetry
 * streaming, and real firmware upload via the official OTAUpdate library
 * of the arduino:renesas_uno core (the ESP32-S3 modem downloads the .ota
 * from the IDE's ephemeral HTTP server and reflashes the RA4M1).
 *
 * This module deliberately does NOT touch ArduinoBLE: WiFiS3 and BLE share
 * the ESP32-S3 modem and must not run in the same sketch. The BLE bytecode
 * runtime remains available on the feature/always-on-ble-runtime branch.
 *
 * Ports:
 *   UDP 47801  discovery — request  {"t":"MBR4_DISCOVER","v":1}
 *                          response {"t":"MBR4_HERE","v":1,"name":...,
 *                                    "mac":...,"ip":...,"fw":...,"batt":...,
 *                                    "mode":"ap"|"sta"}
 *   TCP 47802  commands  — one JSON object per line (NDJSON). See
 *                          MANUAL_WIFI_TCP_OTA.md §2.2 for the full table.
 *
 * Network bring-up: station mode with the credentials stored in dataflash;
 * falls back to a configuration AP when credentials are missing or the join
 * times out. AP SSID: `<custom name>-<mac4>` when the hub has been named,
 * `MBR4-<mac4>` otherwise (password "matrix2026" either way) — the MAC
 * suffix is always kept so identically-named robots can never collide.
 * Renames reach the SSID on the next power-cycle.
 *
 * Recovery mode (guaranteed un-brick): hold BTN_UP while powering on and
 * begin() never returns — the hub sits in a network-only loop (OLED shows
 * "OTA MODE" + IP) waiting for a new OTA upload, so a user sketch that
 * crashes or blocks forever can always be replaced without USB.
 *
 * Dataflash map (8 KB RA4M1 dataflash, 1 KB blocks):
 *   Block 0    reserved for the vEEPROM lib (IMU cal). Untouched.
 *   Block 6    THIS module's config record, magic 'MBRW' (see .cpp).
 *   Block 7    BLE branch fused config ('MBRC'). Untouched, so a hub that
 *              switches between the BLE and WiFi firmwares keeps the BLE
 *              settings. NOTE: the BLE branch stores bytecode in blocks
 *              1..6 — flashing a >5 KB bytecode program over there will
 *              overwrite this block; the 'MBRW' magic makes the loss safe
 *              (we fall back to defaults instead of reading garbage).
 */
#ifndef MINIR4_WIFI_RUNTIME_H
#define MINIR4_WIFI_RUNTIME_H

#include <Arduino.h>
#include <stdint.h>

#define MINIR4_WIFI_RUNTIME_VERSION "1.0.0"

class MiniR4WiFiRuntimeClass
{
public:
    MiniR4WiFiRuntimeClass();

    /**
     * @brief Bring up WiFi (STA or AP fallback), discovery and TCP server.
     *
     * Must be called AFTER MiniR4.begin(). Never blocks the sketch when the
     * network is unavailable: STA join is bounded by a timeout, and every
     * failure path degrades to "keep trying in poll()".
     *
     * If BTN_UP is held at the moment of the call, enters recovery mode and
     * never returns (network-only loop; the user sketch is not executed).
     */
    void begin();

    /**
     * @brief Service discovery, TCP commands, telemetry and OTA.
     *
     * Non-blocking; call from the top of loop(). Typical wrapper:
     *
     *     void loop() {
     *         WiFiRuntime.poll();
     *         userLoop();
     *     }
     */
    void poll();

    /**
     * @brief Network-safe drop-in replacement for Arduino's global delay().
     *
     * Sleeps `ms` milliseconds in ~20 ms slices, calling poll() between
     * slices so long block-generated waits never starve the TCP server
     * (the starvation failure mode documented on the BLE branch).
     */
    void safeDelay(uint32_t ms);

    /** @brief Persist a robot name (1..24 printable ASCII). */
    bool setDeviceName(const char* name);

    /** @brief Persist WiFi credentials (ssid 1..32, pass 0..63 chars). */
    bool setCredentials(const char* ssid, const char* pass);

    /** @return true when connected as station or running the fallback AP. */
    bool isNetworkUp() const { return _netMode != NET_DOWN; }

    /** @return true while in AP fallback mode. */
    bool isAPMode() const { return _netMode == NET_AP; }

private:
    enum NetMode : uint8_t { NET_DOWN = 0, NET_STA, NET_AP };

    void _startNetwork(bool recovery);
    void _recoveryLoop();                     // never returns
    void _pollDiscovery();
    void _pollCommands();
    void _pollTelemetry();
    void _handleLine(char* line);
    void _handleOta(const char* url);
    void _sendJson(const char* fmt, ...);
    void _sendDiscoveryReply(const char* json, size_t len);
    void _fillIdentity();                     // _name/_mac4 from flash+MAC
    void _oledStatus(const char* line1, const char* line2);

    bool _readConfig(char* nameOut, char* ssidOut, char* passOut);
    bool _writeConfig(const char* name, const char* ssid, const char* pass);
    void _refreshMacIdentity();

    NetMode  _netMode;
    bool     _begun;
    bool     _nameCustom;          ///< a user-set name exists in flash
    char     _name[25];
    char     _mac4[5];
    uint8_t  _macCache[2];         ///< persisted MAC bytes 4..5 (0xFFFF = unset)
    char     _ssid[33];
    char     _pass[64];
    uint32_t _lastStaRetryMs;

    // TCP line assembly (commands are small and flat; no ArduinoJson).
    char     _lineBuf[192];
    uint16_t _lineLen;

    // Telemetry stream state.
    bool     _tmOn;
    uint16_t _tmIntervalMs;
    uint32_t _tmLastMs;
    uint8_t  _dhtEnabledMask;      ///< bit N = poll DHT on D(N+1)
    uint8_t  _dhtLastAppliedMask;
};

extern MiniR4WiFiRuntimeClass WiFiRuntime;

#endif  // MINIR4_WIFI_RUNTIME_H
