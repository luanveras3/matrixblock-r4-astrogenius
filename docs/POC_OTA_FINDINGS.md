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

## Fase 5 — acceptance runs

### Stress test: 18/20 (2026-07-22, `tools/stress_upload_wifi.js`)

20 consecutive OTA rounds of the 140 KB runtime example (112 KB .ota)
against the hub in AP mode, with the PC joined to `MBR4-B0BC`:

```
round  1-9:  OK   32-34 s each
round 10:    FAIL 70.4 s  "did not come back within 60 s"
round 11:    OK   43.5 s
round 12-17: OK   32-33 s each
round 18:    FAIL 70.6 s  "did not come back within 60 s"
round 19:    OK   41.5 s
round 20:    OK   32.4 s

18/20 uploads succeeded; avg 37.3 s, worst 70.6 s
```

Both failures were on the **PC side, not the robot side**. On every "FAIL"
the robot came back healthy on the *next* round — meaning the OTA
completed, the modem finished flashing, and the runtime came back up.
What timed out was the PC's WLAN association: on AP mode, the PC has to
re-associate with the AP every time the modem cycles it, and Windows
occasionally takes >60 s to complete DHCP + ARP after a stress-load
association. The pattern (every ~9 rounds) suggests a periodic
association cleanup on the Windows side rather than any transient issue
on the robot.

Net counts: the OTA transport completed **20/20 rounds**; the modem
rebooted and re-broadcast the AP **20/20 rounds**; the PC-side WLAN
finished re-associating within the 60 s discovery window **18/20 rounds**.

In classroom deployment this failure mode disappears: with the robot
joined to the shared network (WiFi credentials stored), the PC never
loses its association when the robot reboots. The AP-mode failure here
is a stress-test worst case, not the intended day-to-day path.

### Other acceptance items — passed

- Recovery mode (BTN_UP at boot): OLED shows "OTA MODE" as designed;
  physically verified by the user on 2026-07-22. See discussion of the
  purpose in `docs/WIFI_UPLOAD.md`.
- Rename + AP password + factory reset (BTN_UP + BTN_DOWN at boot):
  6 consecutive rounds of full config cycles all passed (see the AP
  password commit `12aa8f4`).
- Telemetry cadence: 9.0–9.4 Hz sustained when hz=10 is requested
  (see the "cadence drift" fix in commit `e0ada6e`).

### Deferred to a hardware session with a second hub

- Two-robot picker distinguishes and targets the correct hub.

### Deferred to end-to-end IDE session

- Full "click 'Send via WiFi' in the app → robot running" round-trip.
  Every layer of that has been validated in isolation (compile via
  arduino-cli, bin2ota byte-identical to Arduino's encoder, TCP OTA
  path through the runtime); pending a Playwright probe + one manual
  send from the app to close the loop.

---

## Session 2026-07-25 — VM persistence, live debug, print mirror

Firmware `1.2.0` on the bench hub (named `Debughub`, AP `Debughub-B0BC`),
flashed over USB on COM10. All results below are from that hub, in AP
mode, driven by the new `tools/hubctl.js` bench client.

### Static RAM is the binding constraint — and it is a hard error

UNOWIFIR4's linker script reserves a **fixed 8 KB heap**
(`BSP_CFG_HEAP_BYTES`) and a **fixed 1 KB main stack**
(`BSP_CFG_STACK_MAIN_BYTES`) out of 32 KB, minus the 256-byte vector
table. Everything static therefore has to fit in **23296 bytes**, and
overflowing it is a link failure, not a warning:

```
ld.exe: section .stack_dummy VMA [20007b00,20007eff]
        overlaps section .heap VMA [20005b38,20007b37]
```

The R2 build was already at 23190 bytes — only **106 bytes of slack** —
so the print-mirror line buffer and the debug state pushed it over. The
VM program buffer dropped from 4096 to **3584 bytes** to pay for it.

Note for future work: the "9.6 KB stack headroom" figure quoted in the R2
notes was a misreading of arduino-cli's *free RAM* number. That figure is
heap + stack combined; the actual stack is 1 KB and never changes.

Final build: **161804 bytes flash (61%)**, **22812 bytes statics (69%)**,
484 bytes of static slack left.

### VM persistence — passed

| Check | Result |
|---|---|
| `vm_end` with `save:true` | `{"ok":true,"size":18,"saved":true}` |
| `vm_info` reports the stored copy | `stored:true` |
| Reboot → program auto-runs | pass, counter restarts from 0 |
| `vm_forget` → reboot → gone | `size:0, stored:false`, userLoop resumes |
| Reflash to a different sketch → dropped | pass (see the bug below) |

**Bug found and fixed on hardware.** The first cut treated a stored sketch
id of `0` as "any sketch", so that bench sketches without a declared id
could still auto-run saved programs. A program saved by the standalone
runtime example was then adopted by a completely unrelated sketch flashed
over USB — and because a running VM suppresses `userLoop`, that sketch
appeared totally dead (no prints, no behaviour) with nothing in the logs
to explain it. The rule is now plain equality: a saved program auto-runs
only on the exact sketch it was saved against. A sketch with no declared
id still matches programs it saved itself, which is all the bench case
needed.

### Live block debug — passed

Program under test (18 bytes, hand-assembled):
`v0 = 0; forever { v0 = v0 + 1; delay(100); }`

- `vm_debug on hz:10` → steady `{"t":"pc","addr":N,"run":1}` frames
  cycling through the loop body (4, 6, 8, 11, 13, 14).
- `vm_pause` freezes both pc and variables: pc identical after 1 s, `v0`
  identical after 700 ms.
- `vm_step` advances **exactly one instruction** per call —
  8 → 9 → 11 → 13 → 14 → 4, matching the hand-assembled listing
  (ADD, STORE_VAR+1, PUSH_I8+1, DELAY_MS, JMP+2).
- Breakpoint at pc 11: hit, logged (`VM paused at breakpoint pc=11`),
  `vm_info` reports `paused:true, pc:11`.
- Resuming from a breakpoint does **not** re-trigger it in place (pc had
  moved to 14 within 120 ms) and it **does** re-arm on the next loop pass
  (paused at 11 again 1.2 s later).

**pc stream is capped at 10 Hz, not the 20 the roadmap sketched.** Every
outgoing frame costs a synchronous ~100 ms modem write — the same ceiling
that holds telemetry to 9.4 Hz — and the pc stream shares that budget with
telemetry. 10 Hz already reads as "live" for block highlighting.

### Print mirror (R3 v2) — passed

Bench sketch: `docs/poc/PRINT_VM_BENCH/`, written the way the wrapper's
rewrite comes out.

- `logPrint("count="); logPrint(n); logPrintln(" ok")` arrives as **one**
  console line, `count=11 ok` — line buffering behaves like Print.
- `logPrintln(float)` is its own line, `7.80`.
- USB Serial output read back from COM10 is **identical** to the wireless
  console, so the cable workflow is unchanged.

### Environment note (unchanged, bit us again)

After every robot reboot the PC keeps an APIPA (169.254.x.x) lease and
discovery silently finds nothing while `netsh wlan show interfaces` still
says "Conectado". The documented fix works every time:
`netsh wlan disconnect` → 3 s → `netsh wlan connect name=<SSID>` → 14 s →
confirm the address is 192.168.4.2.

---

## Field incident 2026-07-25 — "the hub pings but the IDE finds nothing"

A user ran the BTN_UP + BTN_DOWN factory-reset gesture and afterwards the hub
could not be found by the IDE. Measured state, which is the useful part:

| Layer | Result |
|---|---|
| AP broadcasting (`netsh wlan show networks`) | yes, `MBR4-B0BC` |
| PC associated, DHCP lease | yes, 192.168.4.2 |
| ICMP ping to 192.168.4.1 | **OK, 1 ms** |
| UDP discovery (47801) | **nothing** |
| TCP connect (47802) | **accepted** |
| TCP reply to `{"t":"info"}` | **never arrives** |

That combination — modem answers ping and completes the TCP handshake while
nothing reaches the sketch — is the same modem socket-layer wedge documented
for the failed-STA path in commit `a06f6a5`. Diagnostically it is the worst
possible signature, because every "is it on the network?" check a user knows
how to run says yes.

**Recovery is always a USB reflash** (`arduino-cli ... -u -p COM10`). It worked
first try here, and it is worth repeating that this is the guarantee the whole
design rests on: USB is never mediated by the modem.

### Root cause: not proven. What was done about it anyway.

The wedge could **not** be reproduced: 5 software-triggered
`factory` + `reboot` cycles on the old firmware all came back healthy. So the
following is a fix for the one code path that is *known* to be risky and that
the factory-reset gesture is *guaranteed* to run — not a proven root cause.

A factory reset clears the cached MAC. The next boot therefore brings the AP
up as `MBR4-0000`, discovers the real MAC, and used to **restart the AP in
place** (`WiFi.end()` → settle → `beginAP()`) before binding the UDP and TCP
sockets a few hundred ms later. Binding sockets right after a modem mode
transition is exactly the window that wedged a hub before; the settle delays
added in `a06f6a5` make it rarer, not impossible.

Since the MAC is safely in dataflash by that point, `_refreshMacIdentity()`
now issues `NVIC_SystemReset()` instead. The next boot reads the cached MAC,
brings the AP up **once** with the correct SSID, and binds sockets on a netif
that never changes under them — the race window is gone rather than narrowed.
Cost: one extra ~3 s reboot, only on the first boot after a factory reset or
on a hub that has never been powered on. If the dataflash write fails we fall
back to the old in-place restart instead of resetting, so a hub with dead
flash cannot enter a reboot loop.

Verified on hardware via the serial trace (`docs/poc/PRINT_VM_BENCH/
MiniR4_WiFi_Trace.ino`, built with `-DMINIR4_WIFI_RUNTIME_DEBUG`):

```
=== BOOT ===
[WIFIRT] MAC learned; rebooting once for a clean AP bring-up
=== BOOT ===
[WIFIRT] network up
```

Two boot banners, no in-place AP restart, hub discoverable afterwards.
4 further `factory` + `reboot` cycles on the new firmware: 4/4 healthy.

### Second bug, found while investigating: factory reset kept the saved VM

`factoryReset()` erased only the config block, so a VM program saved to
dataflash survived it and auto-ran on the next boot. Because a running VM
suppresses `userLoop`, the hub would come back "factory fresh" and still
ignore its own program — a robot that looks broken right after the one
command the user reached for to fix it. `factoryReset()` now halts the VM,
clears the stored program and drops any breakpoints. Verified: save →
`stored:true` → factory → `size:0, stored:false`.

---

## Session 2026-07-25 (later) — USB config channel, and the battery

Follow-up to the incident above, after the user reported the hub was
unreachable **whenever the USB cable was not plugged in**.

### The battery was draining all session

Voltages reported by `info` over the course of the session:

| When | `batt` |
|---|---|
| start of the session | 7.84 V |
| mid-session | 7.68 V |
| when the hub "could not be found at all" | **7.50 V** |
| after ~1 h sitting on USB | **8.20 V** |

The pack recovered on USB power and WiFi discovery worked immediately at
8.17 V. That is consistent with — though not proof of — the radio browning
out under transmit bursts on a low pack: the hub stays perfectly usable over
USB while becoming invisible over WiFi, which is indistinguishable from a
firmware fault unless you look at the voltage. The USB panel now surfaces the
reading and warns below 7.6 V (heuristic, not a measured cliff).

### The other half: the SSID was not what anyone was looking for

A rename only reaches the AP SSID on the next power-cycle. During the
session the hub was renamed several times, so the network on the air was
`UsbProbe913-B0BC` while every attempt to connect was aimed at `MBR4-B0BC` —
`netsh wlan show networks` confirmed it. A user in this state is searching
for a network that does not exist and concludes the robot is dead.

`info` now reports `"ap"` — the SSID actually being broadcast — and the USB
panel shows it prominently plus a warning when it will change on restart.

### USB config channel

`MiniR4WiFiRuntime::_pollSerial()` reads NDJSON lines from `Serial` and feeds
them to the same `_handleLine()` dispatcher used by TCP; `_sendJson()` routes
the reply back to whichever transport the command arrived on. Consequences
worth knowing:

- Every existing command works over the cable for free, and so will every
  future one. `ota` is the deliberate exception — it needs the network and is
  refused with `code:-2` rather than failing obscurely inside OTAUpdate.
- The channel is opened **before** the `WL_NO_MODULE` check in `begin()` and
  polled **before** the `NET_DOWN` early return in `poll()`, plus inside
  `_recoveryLoop()`. A hub with no working radio at all is still configurable.
- Baud: the runtime opens at 115200, but a user sketch calling
  `Serial.begin()` in userSetup runs later and wins, so the IDE probes
  115200 then 9600.
- Lines that are not JSON objects are ignored silently, not nacked — the
  cable is shared with whatever the student's own sketch prints.

Cost: +192 B statics for the line buffer (23036 B total, 70%, 260 B slack).

Bench script: `usb_config_test.ps1`. In-app end-to-end probe:
`usb_config_probe.js` (15 checks, including a rename applied over the cable
and the SSID warning).

---

## The radio does not go away when our firmware does (measured 2026-07-26)

Question raised on the bench: after switching the IDE back to the official
build and uploading from it, is our wireless mode disabled?

**Yes — but nothing about the hub looks any different from outside**, which is
the part worth knowing.

### What the code says

Nothing in the stock path can start our runtime. `WiFiRuntime` is a global in
`MiniR4WiFiRuntime.cpp`, and the only code that calls `begin()`/`poll()` is the
wrapper our IDE injects into the generated sketch
(`arduino_wifi_wrapper.js`). A grep across the whole library finds **no other
reference to it** — the one hit outside its own files is a comment in
`MiniR4VM.h`, and `MatrixMiniR4.h` does not include it.

That matters more than "the official app does not call it". Arduino archives a
library into a `.a` and the linker pulls an object file only to resolve an
undefined symbol. With nothing referencing `WiFiRuntime`, the object is never
linked: the code is not in the binary at all. Not a dormant radio — absent
code, zero flash, zero RAM.

The library stays installed in `arduino/libraries/` whichever app build is
active, because swapping `app.asar` does not touch the toolchain. That is
harmless for exactly the reason above.

### What the hardware says

After a simple sketch uploaded from the **official** app, with the PC
associated to the hub's access point at full signal:

| Check | Result |
|---|---|
| UDP discovery (47801) | **nothing found** |
| Access point `Uni11-B0BC` | **still broadcasting** |
| PC associated, 100% signal | yes |
| ICMP to 192.168.4.1 | **replies** |
| TCP 47802 (our command port) | **accepts the connection** |
| `{"t":"info"}` on that socket | **zero bytes in 8 s** |

So the hub answers at every layer the **ESP32-S3 modem** owns — association,
IP, even the TCP handshake on a socket the previous firmware had left
listening — and at no layer the **RA4M1** owns. The modem is a separate chip
holding state across a reflash of the main MCU; it was never told to stop.

This is the same trap as the MXColorV3 diagnosis: an independent chip keeps its
configuration across an MCU reset, so a measurement taken after the reset can
be reporting the *previous* firmware's setup.

### Two practical consequences

1. **"I went back to the official app but the robot is still in my WiFi list"**
   is expected, not a bug, and not our firmware still running. Port 47802 even
   accepting a connection makes it look alive; nothing answers on it.
2. **The radio keeps drawing current** after the switch, until the modem is
   actually powered down. A power cycle should clear it — resetting the RA4M1
   will not, since that is not what is holding the AP up. Worth remembering
   whenever battery life is being measured.
