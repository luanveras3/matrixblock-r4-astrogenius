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
 *   Blocks 1-4 saved VM bytecode, magic 'MBVM' (16-byte header + up to
 *              3584 bytes of program). Same region the BLE branch uses for
 *              bytecode, and deliberately so: the two firmwares can never
 *              both be running, and a hub that switches between them simply
 *              fails the magic/CRC check and starts with no stored program.
 *   Block 6    THIS module's config record, magic 'MBRW' (see .cpp).
 *   Block 7    BLE branch fused config ('MBRC'). Untouched, so a hub that
 *              switches between the BLE and WiFi firmwares keeps the BLE
 *              settings.
 */
#ifndef MINIR4_WIFI_RUNTIME_H
#define MINIR4_WIFI_RUNTIME_H

#include <Arduino.h>
#include <stdint.h>
#include "MiniR4VM.h"

#define MINIR4_WIFI_RUNTIME_VERSION "1.2.0"

/// Simultaneous VM breakpoints the IDE may arm. Eight covers classroom use
/// (students set one or two) without growing the runtime's RAM footprint.
#define VM_MAX_BREAKPOINTS 8

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

    /**
     * @brief Keep the transports alive from inside a user loop.
     *
     * Returns `cond` unchanged so it can wrap a loop condition:
     *
     *     while (WiFiRuntime.tick(!MiniR4.BTN_UP.getState())) { }
     *
     * which is what the IDE wrapper rewrites every user `while` / `for` into.
     *
     * Why this exists: the runtime is cooperatively scheduled — poll() only
     * runs when loop() comes back around. Student programs almost always open
     * with a "wait until BTN_UP is pressed" gate (the board starts executing
     * the moment it resets, so they need one), and that compiles to a bare
     * busy-wait. Without this, the very first thing the typical program does
     * is take the hub off the network, over WiFi *and* over USB.
     *
     * Self-throttling: a tight loop calls this tens of thousands of times a
     * second, and every discovery poll is a modem transaction. Real work is
     * done at most every TICK_INTERVAL_MS; other calls return immediately, so
     * wrapping a loop costs the student nothing measurable.
     *
     * Never advances the VM — see pollNetworkOnly() for why re-entering it
     * would blow the stack.
     */
    bool tick(bool cond = true);

    /**
     * @brief Push a log line to the connected IDE (R3 — remote console).
     *
     * NDJSON frame `{"t":"log","s":"..."}` — appears in the HUD's Log tab.
     * Safe to call from anywhere; no-op when no client is connected. The
     * user sketch can call this the same way it would call Serial.println
     * ("value: 42") — the wrapper's `Serial.println` redirect will call
     * it automatically for USB-compiled sketches so students see prints
     * without plugging a cable.
     *
     * Max effective length ~200 chars (bounded by _sendJson's stack buffer
     * minus JSON overhead). Longer messages are truncated.
     */
    void log(const char* msg);

    /**
     * @brief Serial.print/println mirror — USB cable AND remote console.
     *
     * R3 v2: the wrapper rewrites every `Serial.print(x)` / `Serial.println(x)`
     * a block generator emits into `WiFiRuntime.logPrint(x)` /
     * `logPrintln(x)`, so a student's print blocks reach the IDE console with
     * no cable and without learning a new block. USB behaviour is unchanged —
     * the value still goes to `Serial` exactly as before.
     *
     * Semantics follow Print: `logPrint` accumulates into a line buffer,
     * `logPrintln` terminates the line and ships it as one `{"t":"log"}`
     * frame. So `print("x="); print(3); println();` produces the single
     * remote line `x=3`, matching what the serial monitor shows.
     *
     * Lines longer than the buffer are flushed early (split across frames);
     * a bare `println()` with nothing buffered emits no frame (it would be
     * an empty line in the console for no information).
     */
    template <typename T> void logPrint(const T& v)
    {
        Serial.print(v);
        _logAppend(String(v));
    }
    template <typename T, typename F> void logPrint(const T& v, F fmt)
    {
        Serial.print(v, fmt);
        _logAppend(String(v, fmt));
    }
    template <typename T> void logPrintln(const T& v)
    {
        Serial.println(v);
        _logAppend(String(v));
        _logFlush();
    }
    template <typename T, typename F> void logPrintln(const T& v, F fmt)
    {
        Serial.println(v, fmt);
        _logAppend(String(v, fmt));
        _logFlush();
    }
    void logPrintln()
    {
        Serial.println();
        _logFlush();
    }

    /**
     * @brief Declare the identity of the compiled sketch (VM persistence).
     *
     * The wrapper emits a fresh random `MINIR4_SKETCH_ID` on every build and
     * the driver setup() passes it here before begin(). A saved VM program
     * carries the id of the sketch it was uploaded against; when the two
     * disagree the stored program is dropped instead of resumed.
     *
     * Why: a USB or OTA reflash replaces the native program under the VM's
     * feet. Auto-running yesterday's bytecode on top of a different sketch
     * would be surprising at best (and the "why is my robot doing that?"
     * classroom bug at worst). Same scheme as the BLE branch.
     *
     * Call before begin(). The match is exact — a sketch that never calls
     * this keeps id 0 and will only auto-run programs it saved itself, never
     * one saved by a different sketch.
     */
    void setSketchId(uint32_t id) { _sketchId = id; }

    /** @brief Persist a robot name (1..24 printable ASCII). */
    bool setDeviceName(const char* name);

    /** @brief Persist WiFi credentials (ssid 1..32, pass 0..63 chars). */
    bool setCredentials(const char* ssid, const char* pass);

    /**
     * @brief Persist a custom AP password (8..63 chars, WPA2 minimum).
     *
     * Empty string reverts to the default ("matrix2026"). Takes effect on
     * the next boot — restarting the AP mid-session would drop the very
     * client that asked for the change.
     */
    bool setAPPassword(const char* pass);

    /**
     * @brief Erase the config record: name, WiFi credentials, AP password
     * and cached MAC all return to defaults on the next boot.
     *
     * Also reachable without the IDE: hold BTN_UP + BTN_DOWN together
     * while powering on (rescues a hub whose AP password was forgotten).
     */
    bool factoryReset();

    /** @return true when connected as station or running the fallback AP. */
    bool isNetworkUp() const { return _netMode != NET_DOWN; }

    /** @return true while in AP fallback mode. */
    bool isAPMode() const { return _netMode == NET_AP; }

    /** @return true while an ephemeral VM program is executing.
     *
     * The wifi wrapper's driver loop uses this to skip the user's
     * compiled userLoop while the VM is active — so a "Send VM (fast)"
     * upload seamlessly takes over from an OTA-uploaded program until
     * the user stops the VM (vm_stop, reboot, or a fresh vm_start).
     */
    bool isRunningVM() const;

    /**
     * @brief Service the network stack without advancing the VM.
     *
     * Registered as MiniR4VM's yield callback so long DELAY_MS opcodes
     * keep the UDP/TCP transport responsive. Must NOT re-enter the VM
     * (that would recurse into DELAY_MS → yield → step → DELAY_MS and
     * blow the Cortex-M4 stack — the exact bug fixed in a9db855 on the
     * BLE branch). Safe to call from anywhere.
     */
    void pollNetworkOnly();

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

    void _logAppend(const String& s);
    void _logFlush();

    NetMode  _netMode;
    bool     _begun;
    bool     _nameCustom;          ///< a user-set name exists in flash
    char     _name[25];
    char     _mac4[5];
    uint8_t  _macCache[2];         ///< persisted MAC bytes 4..5 (0xFFFF = unset)
    char     _ssid[33];
    char     _pass[64];
    /// SSID the fallback AP is ACTUALLY broadcasting right now. A rename only
    /// reaches the SSID on the next power-cycle, so after a rename or a
    /// factory reset the live name and the configured one disagree — and a
    /// user hunting for the network they just named finds nothing. Reported
    /// verbatim in `info` so the IDE can say which WiFi to actually join.
    char     _apSsid[33];
    char     _apPass[64];          ///< effective AP password (default or custom)
    bool     _apPassCustom;        ///< a user-set AP password exists in flash
    uint32_t _lastStaRetryMs;
    uint32_t _tickLastMs;          ///< throttle for tick()

    // TCP line assembly (commands are small and flat; no ArduinoJson).
    char     _lineBuf[192];
    uint16_t _lineLen;

    // --- USB serial config channel ---
    // The same NDJSON command set, reachable over the cable. This exists so
    // configuration never depends on the network being configured: a hub with
    // wrong credentials, a forgotten AP password, or a modem that has stopped
    // answering is still fully manageable from the IDE over USB. Deliberately
    // not a second protocol — _pollSerial() feeds _handleLine(), so every
    // command that works over TCP works here the day it is added.
    void _pollSerial();
    char     _serialBuf[192];
    uint16_t _serialLen;
    bool     _replyToSerial;   ///< route _sendJson to Serial for this command

    // Print-mirror line buffer (R3 v2). Bounded well under _sendJson's
    // 256-byte frame budget so an escaped line always fits.
    char     _logLine[128];
    uint8_t  _logLineLen;

    // Telemetry stream state.
    bool     _tmOn;
    uint16_t _tmIntervalMs;
    uint32_t _tmLastMs;
    uint8_t  _dhtEnabledMask;      ///< bit N = poll DHT on D(N+1)
    uint8_t  _dhtLastAppliedMask;

    // --- VM (R2) ---
    // Send-VM flow: vm_start (size) → 1..N vm_chunk frames (base64) →
    // vm_end → optional vm_run (auto-run on end for a simpler client).
    // vm_stop halts; vm_erase drops the program.
    //
    // Persistence (`"save":true` on vm_end, or the vm_save command) copies
    // the program to dataflash blocks 1..5 so it survives a power cycle and
    // auto-runs at boot — the "leave the notebook behind" mode. The RAM copy
    // is still the one that executes; flash is only the backing store.
    MiniR4VM _vm;
    uint16_t _vmProgramSize;       ///< 0 = no program loaded
    uint16_t _vmRxExpected;        ///< bytes announced by vm_start
    uint16_t _vmRxOffset;          ///< bytes received so far
    bool     _vmReceiving;         ///< between vm_start and vm_end
    uint32_t _sketchId;            ///< identity of the running native sketch
    bool     _vmStored;            ///< a valid program sits in dataflash
    bool     _inVm;                ///< re-entry guard for _pollVm()
    void _handleVmStart(long size);
    void _handleVmChunk(const char* b64);
    void _handleVmEnd(bool save);
    void _handleVmRun();
    void _pollVm();
    bool _saveVmProgram();         ///< RAM copy → dataflash
    bool _loadVmProgram();         ///< dataflash → RAM copy (validates)
    bool _forgetVmProgram();       ///< erase the stored program

    // --- VM live debug (R2 "debug de bloco ao vivo") ---
    // The pc→block map lives in the IDE, not here: the robot only reports
    // raw program counters and the editor resolves them against the map it
    // produced at compile time. Costs the firmware ~nothing and keeps the
    // wire format stable regardless of how the compiler evolves.
    bool     _vmDebugOn;           ///< stream {"t":"pc"} frames
    bool     _vmPaused;            ///< stepping stopped, program still loaded
    bool     _vmStepOnce;          ///< execute exactly one instruction
    uint16_t _vmPcIntervalMs;      ///< throttle for the pc stream
    uint32_t _vmPcLastMs;
    uint16_t _vmPcLastSent;        ///< suppress duplicate pc frames
    uint16_t _vmBreak[VM_MAX_BREAKPOINTS];
    uint8_t  _vmBreakCount;
    bool     _vmBpArmed;           ///< false right after resume/step (skip once)
    bool _vmIsBreakpoint(uint16_t pc) const;
    void _sendPcFrame(bool force);
    void _sendVarsFrame();
};

extern MiniR4WiFiRuntimeClass WiFiRuntime;

#endif  // MINIR4_WIFI_RUNTIME_H
