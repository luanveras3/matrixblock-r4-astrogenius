# R10 plan — hub firmware manager

Requested 2026-07-26: "the Firmware Update menu sends you to the MATRIX site to
download a file, then you have to enter DFU and flash. Can we make the app
download and flash directly, without DFU?"

Yes for most of it, and the answer starts by separating three things that are
routinely confused.

---

## 1. Three layers, only one of which uses DFU

| Layer | What it is | How it is programmed | DFU? |
|---|---|---|---|
| **RA4M1** | the main MCU: user sketch, `MiniR4WiFiRuntime`, `MiniR4VM` | `arduino-cli` over USB serial, **or OTA over WiFi** | no |
| **ESP32-S3** | the WiFi/BLE modem ("usb-bridge" firmware) | `arduino-fwuploader` over USB | no |
| **STM32F103** | the MMLower motor/encoder coprocessor | `STM32_Programmer_CLI` in DFU mode | **yes** |

**Everything this fork ships lives in the RA4M1 layer.** That is why no part of
this project has ever needed DFU, and why OTA works at all — it reprograms
exactly that layer. Our firmware is not even installed separately: it ships as
library source, so every IDE compile embeds it and a hub receives it with the
first program a student uploads.

The DFU flow in the Firmware Update menu is for the **STM32F103 only**.

## 2. What the app already does

More than it appears. `dfu/STM32_Programmer_CLI.exe` is bundled, and the modal
already scans for the device, takes a firmware path and runs the flash
(`dfu_scanBtn`, `dfu_selectFirmwareBtn`, `dfu_fwPath`, `dfu_run`,
`dfu_cmdOutput` in `views/main.html`).

Only two steps are manual:

1. downloading the file — the menu opens a browser at matrixrobotics.com;
2. putting the chip into DFU mode.

## 3. Step 1 is worth doing and is straightforward

Fetch the firmware from **the official URL, inside the app**: download to a
temp folder, verify a checksum, prefill `dfu_fwPath`. That removes the browser,
the manual download and the file picker — most of the friction, with no new
risk.

### Do NOT mirror the binaries on our own Drive

This was the first idea and it should be rejected, for a reason stronger than
licensing.

Today a user downloads firmware from the manufacturer. Mirroring it on a
personal Drive makes them trust **us** to serve an authentic binary, with no
signature and no verification, for a file that is flashed straight into a
coprocessor. That is the textbook supply-chain attack shape, in a product used
by schools. A compromised Drive account or a swapped link becomes malicious
firmware on every hub in a classroom.

Redistribution is also MATRIX's call, not ours.

Fetching from the official URL and verifying a published checksum gets the same
convenience while authenticity stays with the manufacturer.

## 4. Step 2 — eliminating DFU — is NOT promised

Entering the STM32F103 bootloader normally depends on the BOOT0 pin. If that is
a jumper or a button on the board, no amount of software removes the step.
If the RA4M1 can drive it, automation becomes possible.

**Investigate before promising anything**, and record the finding in
`docs/STM32_OTA_FINDINGS.md`:

- how the hub currently enters DFU (jumper, button combination, or a command);
- whether BOOT0 is reachable from the RA4M1;
- whether the F103's UART bootloader is exposed to the RA4M1, which would allow
  a wireless MMLower update — the R10 stretch goal, also unpromised.

## 4b. Release gate — the ESP32-S3 bridge version

**Decision 2026-07-26: the release waits for this.** Not for all of R10 — for
one piece of it.

OTA needs bridge firmware **>= 0.5.0** (`startDownload`). Below that, "Send via
WiFi" — the fork's headline feature — fails with a bare OTA error code. Someone
installs the fork, tries the one thing it is being promoted for, sees a number,
and concludes it is broken. That is a bad enough first impression to hold a
release for.

Minimum viable scope, much smaller than full R10:

1. ~~Report the bridge version.~~ **DONE (`bf5710a`).** `WiFi.firmwareVersion()`
   is in the `info` frame next to the runtime version. Bench hub reports
   `"bridge": "0.6.0"`.
2. ~~**Check it before an OTA**~~ **DONE (`bf5710a`).** `wifi_upload.js` asks for
   `info` before compiling and refuses a version below 0.5.0, naming what it
   found and what it needs, and pointing at the Arduino Firmware Updater or the
   USB cable. Two deliberate leniencies: an absent field proceeds (an older
   runtime does not report it, and refusing would block hubs that work), and a
   version failure is not retried by the automatic second attempt.
3. Offer the update: bundle `arduino-fwuploader` and run it from the app.
   This layer needs **no DFU**. **Still open** — and no longer blocks release.

Steps 1 and 2 removed the bad first impression, and were small. Step 3 is the
real convenience and is where the bundling work is.

**The release gate is now clear.** Only the refusal path is unverified: the
bench hub is on 0.6.0, so the branch that fires has been reasoned through but
never executed. Testing it needs a hub with old modem firmware.

The rest of R10 — the four-version panel, the MMLower over DFU — does **not**
gate the release. The current Firmware Update menu behaves exactly as the
official app does there; it is not a regression this fork introduces.

## 5. Suggested order

1. **In-app download from the official URL + checksum.** Delivers value on its
   own and cannot make anything worse.
2. **Version panel**: current versus available for all three layers. The `info`
   command already reports the runtime version, and
   `WiFi.firmwareVersion()` gives the modem's.
3. **Bundle `arduino-fwuploader`** so the ESP32-S3 modem updates from the app
   too — no DFU there either, and it is the layer whose version actually
   gates OTA (`startDownload` needs bridge firmware >= 0.5.0).
4. **Only then** the BOOT0 investigation.

## 6. Acceptance

The panel shows the four versions correctly; the user updates the usb-bridge
and the MMLower from the app without external tools; every failure path leaves
recovery instructions on screen.
