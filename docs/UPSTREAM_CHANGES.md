# Changes to upstream files — a review guide for MATRIX Robotics

This fork is a **whitelist-based delta**: the repository tracks only what we
add or change, not the whole product. That keeps the diff small, but it also
means the pristine baseline is **not** in this repository — it is fetched from
the vendor archive at build time (`patch_asar.js`). So `git log -p` shows a
modified upstream file as if it were created whole.

This document exists so nobody has to guess. It lists every upstream file we
touch, what changed in it, and where the reasoning lives.

`patch_asar.js`'s `PATCHES` array is the machine-readable version of the same
list: every entry is a file injected into `app.asar`.

---

## The short version

Almost everything in this fork is **new files**, which need no review against
an original: the WiFi/OTA runtime, the bytecode VM, every IDE module, the
bytecode generators, the tooling. Those can be read on their own terms.

Only **five** upstream files are modified. Four are readable source; one is a
minified bundle.

To diff any of them, take your own copy and run:

```bash
diff -u <your copy> resources/app_src/<same path>
```

---

## Modified upstream files

### 1. `arduino/libraries/MatrixMiniR4/src/Modules/Sensors/MiniR4_MXColorV3.cpp`

**Six lines, in `begin()` only.** This is the change most worth your attention,
because it is a bug fix in the shipped library rather than an addition of ours.

`begin()` powered the chip and enabled the ADC but never wrote integration time
or gain, so the TCS34725 kept its post-reset defaults (minimum integration,
1x gain). In ordinary room light the clear channel then falls under the
`if (c < 20) return 0` guard inside `getR/getG/getB`, so every channel reads 0
and `getColorID()` returns -1 — while the sensor answers on I2C and
`begin()` returns true. It looks like a dead sensor and is simply underexposed.

`TCS34725_ATIME` and `TCS34725_CONTROL` were already defined in the header and
written nowhere, which is what gave the omission away.

The fix writes ATIME (50 ms) and gain (4x) before enabling the ADC, and waits
one integration cycle so the first conversion is valid. Measured on the same
sensor and lighting: `0/0/0` and ID `-1` became `63/111/115` and ID `3` (blue).

We suspect this also explains long-standing reports of the V3 sensor
misclassifying colours: a starved signal classifies badly.

Commit: `ca1e71f`.

### 2. `resources/app_src/views/main.html`

Additions only; no upstream markup removed.

- `<script>` tags for our modules, at the end of the body.
- An `astro-*` block of tab-bar, auto-save and code-mode styles and strings.
- Our locale entries inside the existing `en` / `pt-BR` string tables.

The one edit inside upstream content is a comment.

### 3. `resources/app_src/blockly-core/blocks/_mini.js`

Block definitions added for the fork's features. Existing definitions are
untouched — search for the block types listed in `patch_asar.js` to find ours.

### 4. `resources/app_src/blockly-core/msg/scratch_msgs.js`

New message keys appended to the existing `en` and `pt-BR` tables. No upstream
key is modified.

### 5. `resources/app_src/app.compressed.js`

**The hard one.** This is the bundled, minified main+renderer. Our changes are
surgical but a textual diff is painful.

If you are reviewing this fork, treat this file as the place to ask us for a
written summary rather than reading the diff. We are happy to provide one per
change on request.

---

## Firmware: what is new versus what is shared

New modules, safe to read standalone:

- `MiniR4WiFiRuntime.{h,cpp}` — discovery, the NDJSON command server over TCP
  **and USB serial**, telemetry, OTA, the VM host, `tick()`, `waitForStart()`.
- `MiniR4VM.{h,cpp}` — the bytecode VM. Ported from the fork's earlier BLE
  branch with the BLE dependency replaced by a transport-agnostic yield
  callback, so it links against WiFiS3 without ArduinoBLE.

Both are additions. Nothing in the stock library is modified to accommodate
them; a sketch that never calls `WiFiRuntime.begin()` behaves exactly as
before.

## Where the reasoning lives

- `CHANGELOG.md` — what shipped, in release order.
- Commit messages — the **why** for each decision, including the ones we got
  wrong and withdrew. Several record measurements taken on real hardware.
- `docs/POC_OTA_FINDINGS.md` — hardware findings with numbers: OTA timing,
  the RA4M1 static-RAM budget, the telemetry ceiling, field incidents.
- `docs/BUG_BLOCKING_USERLOOP.md` — the one bug worth reading in full if you
  ship anything cooperative on this platform.
- `MANUAL_WIFI_TCP_OTA.md` — the original architecture spec, with a header
  noting where reality diverged from it.

## Constraints we measured, which apply to the stock product too

- **Static RAM is capped at 23296 bytes** on UNOWIFIR4. The linker reserves a
  fixed 8 KB heap and 1 KB main stack out of 32 KB, minus a 256-byte vector
  table. Overflowing it is a hard link error, not a warning.
- **Every outgoing WiFi frame costs a synchronous ~100 ms modem write**, which
  is what holds telemetry to ~9.4 Hz rather than the requested 10.
- **`control_wait_until` compiles to a bare `while(!cond);`**. On any runtime
  that needs to service a transport from `loop()`, that busy-wait starves it
  from the first statement of the typical student program. We work around it
  in our wrapper, but the generator output is worth fixing at the source.
