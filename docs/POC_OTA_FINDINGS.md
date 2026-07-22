# Fase 0 — OTA Proof-of-Concept Findings

Status of the four questions from `MANUAL_WIFI_TCP_OTA.md` §Fase 0. Static
(source-level) findings are recorded below; items that require the physical
hub are listed as a checklist with the exact procedure.

## Answered statically (2026-07-22)

### 1. Does `ota.download()` accept plain `http://`? — YES (source-confirmed, pending hardware confirmation)

The RA4M1-side `OTAUpdate` library passes the URL verbatim to the ESP32-S3
modem (`arduino/packages/arduino/hardware/renesas_uno/1.5.1/libraries/OTAUpdate/src/OTAUpdate.cpp`).
The modem firmware (`arduino/uno-r4-wifi-usb-bridge`) delegates to
`arduino-libraries/Arduino_ESP32_OTA`, which selects the client by URL scheme:

```cpp
if(strcmp(_context->parsed_url.schema(), "http") == 0) {
  _client = new WiFiClient();          // plain TCP, no TLS
} else if(strcmp(_context->parsed_url.schema(), "https") == 0) {
  _client = new WiFiClientSecure();
```

Plain `http://` on the LAN is therefore supported by design — no certificate
plan B needed. `setCACert()` is only relevant for `https://`.

### 2. The `.ota` file format — fully pinned down

Confirmed against `Arduino_ESP32_OTA` source **and** the official
`UNOR4WIFI_Animation.ota` artifact from the OTA.ino example
(`tools/fixtures/UNOR4WIFI_Animation.ota`):

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | length of everything after the first 8 bytes (LE) |
| 4 | 4 | CRC32 (zlib polynomial) of everything after the first 8 bytes (LE) |
| 8 | 4 | magic number — UNO R4 WiFi: `0x23411002` (VID `0x2341`, PID `0x1002`, LE) |
| 12 | 8 | version field, byte 7 = `0x40` (LZSS-compressed payload flag) |
| 20 | … | sketch `.bin` compressed with LZSS (Okumura, EI=11, EJ=4, P=1) |

Pipeline: compile → LZSS-encode the `.bin` → prepend magic+version → prepend
length+CRC32. Implemented in `tools/bin2ota.js`; `tools/bin2ota.test.js`
proves byte-identity with the official encoder (decode the official artifact,
re-encode, compare — deterministic encoder, so equality is exact).

### 3. Sketch size without the VM — 51 880 B for blink, 60 068 B for the OTA PoC

Both far below the 262 144 B ceiling (the BLE branch measured 126 904 B with
the VM). `MatrixMiniR4 + WiFiS3 + OTAUpdate` fits with ample margin.

## Hardware checklist (requires the hub — not yet run)

Procedure for each item is in `docs/poc/OTA_POC/OTA_POC.ino` (compiles clean,
22% flash). Record results here.

- [ ] **Bridge firmware version**: flash the PoC via USB; it prints
  `WiFi.firmwareVersion()`. If older than latest, update via Arduino IDE →
  Firmware Updater (or `arduino-fwuploader`) — OTA commands need a recent
  modem firmware.
- [ ] **Plain http:// end-to-end**: `python -m http.server 47800` in a folder
  with a `.ota` (generate one: `node tools/bin2ota.js blink.bin blink.ota`),
  then in the Serial Monitor: `u http://<pc-ip>:47800/blink.ota`. Expect
  download → verify → reboot into blink.
- [ ] **Timing for ~150 KB sketch**: repeat with a large sketch; the PoC
  prints per-phase ms. Record download / verify / update times.
- [ ] **OTA in AP mode**: set `SECRET_SSID ""` (AP mode), join `MBR4-POC`
  (pass `mbr4poc123`) from the PC, serve the file, use
  `u http://192.168.4.2:47800/blink.ota` (PC IP on the AP subnet). If the
  modem cannot download while in AP mode, OTA will require station mode
  (phone hotspot in the classroom) and AP stays for discovery/telemetry only.
