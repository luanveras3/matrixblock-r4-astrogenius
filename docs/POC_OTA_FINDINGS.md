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

## Hardware checklist — RUN 2026-07-22, ALL PASSED

Hub on COM10, PC joined the robot AP (the *hardest* network case — every
item below was validated in AP mode, no router involved).

- [x] **Bridge firmware version**: `WiFi.firmwareVersion()` = **0.6.0** —
  already >= 0.5.0, no update needed. `startDownload`/`downloadProgress`
  work out of the box.
- [x] **Plain http:// end-to-end**: PoC sketch `u http://192.168.4.2:47800/
  runtime.ota` → download, verify, apply, reboot into the new sketch. The
  served file was produced by `tools/bin2ota.js` — accepted end-to-end by
  the real modem (download CRC + verify + LZSS decode), closing the loop on
  the Fase 1 byte-fidelity work.
- [x] **Timing (140 KB sketch, 112 KB .ota)**: download **3.8–4.2 s**
  (~36 KB/s effective — ~900x the BLE branch's 40 B/s), verify **4 ms**,
  apply+reboot ~15 s. Serial-command-to-robot-back ≈ 25 s; the "click →
  robot running" budget is dominated by arduino-cli compilation, as the
  manual predicted.
- [x] **OTA in AP mode**: fully functional — three consecutive OTA rounds
  were performed in AP mode (PoC→runtime via serial trigger, then
  runtime→runtime twice through the real TCP `{"t":"ota"}` product path
  with live download-% status frames). No station network was ever needed.

Also validated on hardware the same day: UDP discovery replies, TCP
ping/info/telemetry, 82-byte telemetry frames (tag 0xA2) at a sustained
**9.0–9.4 Hz** with zero loss when 10 Hz is requested — the synchronous
modem write path costs ~100 ms per frame round-trip, so true 10 Hz is not
reachable without batching; note the BLE branch dashboard polls at 5 Hz, so
this is ~2x the existing UI cadence. Target noted as "9+ Hz sustained".

### Bugs found on hardware and fixed (same day)

1. **`WiFi.macAddress()` returns zeros before the WiFi stack is up** — the
   first boot advertised `MBR4-0000` (every robot would collide). Fix: MAC
   is re-queried after the network comes up, cached in the dataflash config
   record (offsets 126..127), and a misnamed fallback AP is restarted once
   with the right suffix. Later boots use the cache immediately.
2. **Telemetry cadence drift** — `_tmLastMs = millis()` after frame build
   eroded the rate; replaced with catch-up scheduling (+= interval, resync
   when >1 s behind).
3. **Windows Firewall (manual risk nº 4, confirmed real)**: the robot-AP
   network lands on the **Public** profile; the Python that ships as a
   Windows Store app had no Public inbound rule → `ota.download()` error -6
   (ServerConnectError). Serving with node.exe (which had Public allow
   rules) worked instantly. For the IDE this means: the user MUST accept
   the firewall prompt for the app on first use (already covered in
   docs/WIFI_UPLOAD.md troubleshooting).
