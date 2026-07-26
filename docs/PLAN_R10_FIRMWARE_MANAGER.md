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

---

## 7. Version identity — and the app channel

**Shipped 2026-07-26.** `blockly-core/version.js` is the single source of truth
for "which version am I running", and it deliberately names *two*:

- **MATRIXblock Mini R4 v1.0.8** — MATRIX Robotics' released product. Stable.
  Read live from the archive's `package.json`, so an upstream bump shows up on
  its own rather than going stale in a constant.
- **AstroGenius Edition v3.5.0 BETA** — this fork. A community build.

It appears as a chip in the navbar badge, as a footer line in the AstroGenius
dropdown, and as a tooltip on the brand block that spells out the relationship
in full.

The BETA marking is not modesty. Two concrete failure modes it prevents:

1. **Misrouted bug reports.** A teacher hitting a problem in code we wrote
   should not open a ticket with MATRIX. The tooltip says so in as many words,
   in both languages.
2. **Support with no version.** "It doesn't work" is unanswerable without
   knowing the fork build *and* the base it sits on. Now both are one hover
   away, and the dropdown carries them where someone already looks.

### The open piece — switching channels from inside the app

The natural next step, and the reason this sits in the R10 document: let the
user move between **stable** (pristine upstream) and **BETA** (this fork)
without following a rollback procedure by hand.

Mechanically this is already solved on disk. Rolling back is one file copy —
`app.asar.bak` over `app.asar` — and since v3.4.1 it needs nothing else,
because the fork stopped writing to pristine's `lang` key. The missing part is
purely the plumbing:

- Windows locks `app.asar` while the app runs, so the swap cannot happen
  in-process. It needs **quit → swap → relaunch**, driven by a small helper or
  by the main process on exit.
- A fast-install user may not have kept `app.asar.bak`. The switch has to check
  for it and, if absent, say so rather than leaving a half-swapped install.
- Going back to BETA is the same copy in reverse, so both directions want the
  pristine archive kept permanently, not treated as a temporary backup.

Worth doing: for a classroom, "put it back the way it was" in one click — with
the fork one click away again — is the difference between trying a beta and not
risking it. Not release-blocking.

### Versions menu — SHIPPED

`blockly-core/versions.js`. A "Versions…" entry in the AstroGenius dropdown
opens a list of the builds installed side by side; picking one closes the app
and reopens it on that build.

The list is deliberately **not** a scan of resources/. This install has six
archives and four are old fork builds; listing them produced a menu of
near-identical rows inviting someone to switch to a build nobody can identify.
It shows exactly three things: the build running now, the official one if a
pristine archive is found, and whatever `versions.json` names.

`versions.json` is the extension point, and needs no code change:

```json
{ "versions": [
    { "name": "MATRIXblock Mini R4", "vendor": "MATRIX Robotics",
      "channel": "release candidate", "file": "D:/builds/1.0.9-rc2.asar" } ] }
```

`file` is the only required field — relative to resources/ or absolute. The
version number is read out of the archive, so a label can never disagree with
what is actually installed.

#### Five failures, each found by testing and none by reasoning

The first version of this shipped **not working at all**, and the reasons are
worth keeping because every one of them is silent.

1. **Plain `fs` cannot touch `app.asar`.** Electron intercepts any path
   containing `.asar` and serves it as a directory, so `copyFileSync` returns
   ENOENT. `original-fs` is the unpatched module for this.
2. **`window.close()` cannot close this app.** `main.js` does
   `win.on('close', e => { send("close-app"); e.preventDefault(); })` — the
   close is *always* cancelled. The real exit is
   `ipcRenderer.send('close-app')`. The first build called `window.close()`,
   so the app never quit and the helper waited three minutes for a process
   that was never leaving, then correctly did nothing.
3. **`spawn(..., { detached: true })` creates a process that never executes.**
   Measured, not guessed: the identical script runs with `detached: false` and
   runs again through `cmd /c start`, so detachment is what breaks it in this
   renderer. But detachment is exactly what is needed, since the app is about
   to exit — hence `start`.
4. **PowerShell `-File` mis-binds arguments containing spaces**, and the
   executable is `MATRIXblock Mini R4.exe`. Binding failed before the first
   statement, so neither the log nor the ready-marker appeared and there was
   nothing at all to diagnose. Every value is now baked into the script.
5. **A `.bak` name proves nothing.** Four of the six archives here are old fork
   builds, and the first pristine check passed all of them — the feature would
   have reinstalled the fork and called it official. Detection reads the
   archive: fork-only modules, plus the brand in `main.html`, which is what
   catches early builds that added no file to `blockly-core`.

Two of these produce **no error anywhere** — no exception, no log line, no
dialog. That is why the helper now writes `switch.log` next to itself and
signals readiness with a file the app waits for: if the helper cannot start,
the app says so and stays open instead of closing for nothing.

#### The return trip

Once another build is running there is no AstroGenius UI left to offer a way
back, so the helper places a `Back to AstroGenius.cmd` on the Desktop — and
asks Windows where the Desktop is rather than guessing, because it is
localised and usually redirected into OneDrive. A guessed path put the file in
a legacy junction the user would never have opened. It is written only after
the copy succeeds, so a switch that did not happen leaves nothing behind.

Verified end to end by hash, both directions: fork → official (shortcut placed
on the real Desktop, app relaunched) → fork.

## 8. Project file compatibility, both directions

Asked, and worth recording because the answer is not the obvious one.

**`.mbr4` files are compatible in both directions.** They are plain Blockly XML
— block types, field values, coordinates. Compatibility therefore depends
entirely on whether the fork changed the block vocabulary, and it did not:

- **143 block types in pristine, 143 in the fork.** None added, none removed.
  Everything this fork does — WiFi upload, the VM, live debug, the remote
  console — is IDE machinery and firmware, reached through buttons and the
  existing blocks, never through new ones.
- The 68 changed lines in `blocks/_mini.js` swap hardcoded English dropdown
  labels for `AG(...)` lookups. **Every serialized value is untouched** —
  `"true"`, `"L"`, `"R"`, `"readHumidity"` and the rest are identical on both
  sides. Only what the student *reads* changes.

So a project saved in the beta opens in the official app, and vice versa. A
`.mbr4` that used a fork-only block would be the thing that breaks this, and
there is no such block to use.

The one asymmetry is not in the file: a hub last programmed by the fork keeps
the AstroGenius runtime until the official app uploads to it. That is the
firmware layer, covered in `UPSTREAM_CHANGES.md`, and it resolves itself with
the first upload from whichever app is running.
