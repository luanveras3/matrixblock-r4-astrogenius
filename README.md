# MATRIXblock Mini R4 — AstroGenius Edition

Community fork of **MATRIXblock Mini R4 v1.0.8**, built for classroom use by
the AstroGenius Team (a Brazilian robotics team; maintainer: Luan Veras).

**Send programs to the robot over WiFi.** No cable, no queue at the one laptop
with the USB port, no waiting for a full compile to find out something was
wrong. The robot appears in the app, you press send, and it runs.

> **This is a BETA of a community fork.** The official MATRIXblock Mini R4 from
> MATRIX Robotics is the stable product, and it is what you should use if you
> need something dependable today. Please report problems with the features
> below **here**, not to MATRIX — they did not write this code. The app carries
> a BETA badge and a Versions menu that switches back to the official build in
> one click, so trying this costs you nothing permanent.

Current release: **v4.0.0-beta**, built on upstream v1.0.8.
Nothing is installed over the official app — every change is applied surgically
to a copy of the shipped `app.asar`, and the original binary is never modified
in place.

---

## What it does

### Wireless upload (no cable)

The robot joins your network — or serves its own access point — announces
itself, and the app finds it. Sending a program compiles it and pushes it over
the air. A cable is still needed exactly once, to put this firmware on the
robot the first time.

### A bytecode VM, for the fast loop

A full compile-and-flash takes tens of seconds. For iterating on logic, the app
can instead compile your blocks to a compact bytecode and send **that** — the
robot runs it immediately, without reflashing. The program can be kept on the
robot so it survives a power cycle.

### A remote console

`print` blocks stream back to a Log tab in the app while the robot is running,
across the room, with no cable attached. Rate-limited on the robot so a chatty
loop cannot flood the link.

### Live telemetry (HUD)

Battery, uptime, motors, encoders and sensors, updating while the program runs.
Telemetry is only requested while the HUD tab is actually visible, because on
this hardware every outgoing frame costs a synchronous modem write.

### Setup over the USB cable

The path that does not depend on the network already working: name the robot,
set WiFi credentials, switch the radio off for good, and read the hub's state —
all over the cable, from a panel in the app. This exists because "I cannot find
the hub" is not a problem you can fix over the network.

### One connection surface

USB and WiFi in a single panel, reached from the device indicator in the
navbar, instead of five separate pickers.

### Versions menu

Lists the app builds installed side by side and switches between them: the app
closes and reopens on the one you pick. **The switcher is injected into the
build you switch to**, so the official app can switch back from inside itself.
A `versions.json` next to `app.asar` adds more builds without a code change.

Your projects are unaffected in either direction: this fork adds **no blocks**
(143 block types before and after, and every serialized field value is
identical), so a `.mbr4` saved in one version opens in the other.

---

## How it works

[docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md) explains both upload paths end to
end, what each costs, and how the design got here — including the BLE attempt
that came first and why it was abandoned. Every figure in it was measured on
real hardware.

The short version: **OTA** compiles your blocks and reflashes the robot over
the air, so it runs the real generated C++ with no block unsupported, at about
30 seconds a round. **The VM** compiles to bytecode the robot interprets
immediately, so iteration is instant, at the cost of a 3584-byte program limit
and partial block coverage. Both are wireless; you pick per upload.

---

## What v3.x added, and is still here

- **Portuguese (pt-BR) localization** — the full Blockly locale, block dropdown
  labels, and a bilingual runtime i18n layer. Only display labels are
  translated; the generated Arduino code is untouched.
- **Multi-tab editor** with per-tab state.
- **Auto-save and session recovery.**
- **Unsaved-changes indicator.**
- **C++ code mode** — a writable Monaco editor.
- **Export the current sketch as `.ino`.**
- **Keyboard shortcuts.**

See [CHANGELOG.md](CHANGELOG.md) for the detail on each.

---

## Install

Two ways, both in [INSTALL.md](INSTALL.md):

1. **Download the pre-patched `app.asar`** from the latest release and drop it
   into the app's `resources/` directory. No Node, no build.
2. **Build from source** — clone, run `node patch_asar.js`. Recommended if you
   want to read or change anything first.

Either way, **keep the original `app.asar`**. The Versions menu uses it to
switch you back, and the rollback instructions depend on it.

---

## Going back to the official version

One click, from the Versions menu — or a file copy, documented in
[INSTALL.md](INSTALL.md#rolling-back).

Worth knowing: **the robot keeps the AstroGenius firmware until the official
app uploads to it.** Our firmware ships as library source, so it arrives with
the first program a student sends, and it leaves the same way. And after going
back, the robot's radio stays up until you power-cycle it — the WiFi module
holds the access point across a reflash of the main MCU, so the robot can still
appear online with nothing behind it. See
[docs/POC_OTA_FINDINGS.md](docs/POC_OTA_FINDINGS.md).

---

## For MATRIX Robotics, or anyone reviewing this

[docs/UPSTREAM_CHANGES.md](docs/UPSTREAM_CHANGES.md) is written for you: it
lists every upstream file this fork touches, what changed in each, and where
the reasoning lives. Almost everything here is new files; only five upstream
files are modified, and one of those is a minified bundle we are happy to
summarise on request.

Three constraints measured on real hardware apply to the stock product too,
and are written up in [docs/POC_OTA_FINDINGS.md](docs/POC_OTA_FINDINGS.md):
the 23296-byte static RAM ceiling on UNOWIFIR4, the ~100 ms synchronous modem
write per outgoing frame, and `control_wait_until` compiling to a bare
`while(!cond);` that starves any cooperative runtime from the first statement
of a typical student program.

---

## Tests

```
node tools/run_tests.js
```

7 headless suites, 151 assertions: the bytecode assembler, generator handlers,
hardware handlers, procedures, the live-debug source map, the sketch wrapper,
and the OTA binary packer. `node test_app.js` additionally launches the real
app as a smoke test and needs a patched `app.asar` already installed.

---

## Repository layout

The repository is a **whitelist-based delta**: it tracks only what this fork
adds or changes, never the whole product. The pristine baseline is not here —
it is the vendor's `app.asar`, fetched at build time.

```
matrixblock-r4-astrogenius/
├── README.md, CHANGELOG.md, INSTALL.md, RELEASE.md, ROADMAP.md
├── .gitignore                       # whitelist: only tracks changed files
├── patch_asar.js                    # surgical asar rebuilder
├── test_app.js                      # Playwright smoke test (launches the app)
├── probe_helpers.js                 # shared Electron-probe plumbing
├── docs/
│   ├── NEXT_SESSION.md              # start here if you are picking this up
│   ├── UPSTREAM_CHANGES.md          # every upstream file we touch, and why
│   ├── POC_OTA_FINDINGS.md          # hardware measurements, with numbers
│   ├── BUG_BLOCKING_USERLOOP.md     # the one bug worth reading in full
│   └── PLAN_R10_FIRMWARE_MANAGER.md
├── tools/
│   ├── hubctl.js                    # bench NDJSON client (discover/info/watch)
│   ├── bin2ota.js                   # OTA binary packer
│   ├── run_tests.js                 # runs every *.test.js below
│   └── *.test.js                    # 7 headless suites, 151 assertions
├── resources/
│   ├── app.asar                     # generated by patch_asar.js
│   ├── app.asar.bak                 # original v1.0.8 asar (input, keep it)
│   ├── app.asar.unpacked/           # native modules (untouched)
│   └── app_src/                     # patched + new source files
│       ├── app.compressed.js        # upstream bundle, minified (5 edits)
│       ├── views/main.html          # upstream, additions only
│       └── blockly-core/
│           ├── wifi_upload.js       # compile + OTA over the network
│           ├── wifi_hud.js          # shared socket, telemetry, Start button
│           ├── wifi_vm_upload.js    # bytecode path (the fast loop)
│           ├── wifi_vm_debug.js     # live block debug (UI withdrawn)
│           ├── connection.js        # unified USB + WiFi panel
│           ├── usb_config.js        # hub setup over the cable
│           ├── versions.js          # side-by-side builds, one-click switch
│           ├── version.js           # single source of truth for versions
│           ├── navmenu.js           # groups this fork's navbar buttons
│           ├── bytecode.js          # assembler + live-debug source map
│           ├── generator_bytecode/  # blocks -> bytecode
│           ├── arduino_wifi_wrapper.js  # sketch rewriting (see below)
│           ├── blocks/_mini.js      # upstream, dropdown labels only
│           └── msg/scratch_msgs.js  # upstream, keys appended
└── arduino/
    ├── libraries/MatrixMiniR4/src/Modules/
    │   ├── MiniR4WiFiRuntime.{h,cpp}  # discovery, NDJSON, telemetry, OTA
    │   └── MiniR4VM.{h,cpp}           # the bytecode VM
    └── blocks_examples/pt-BR/       # translated examples
```

`arduino_wifi_wrapper.js` earns its name: it rewrites the generated sketch so
`delay` yields to the runtime, `Serial.print` reaches the remote console, and a
blocking start-gate loop becomes `WiFiRuntime.waitForStart()`. That last one is
not cosmetic — see [docs/BUG_BLOCKING_USERLOOP.md](docs/BUG_BLOCKING_USERLOOP.md).

---

## Rebuild strategy

`app.asar` is a Chromium Pickle-format archive with a JSON header
followed by a data section. `patch_asar.js` implements a **surgical
append** rebuild:

1. **Keep the original data section intact.** This is important
   because Electron references native modules by their positions
   inside `app.asar.unpacked/`, and rewriting the archive from
   scratch would break those references.
2. **Append patched files at the end** of the archive.
3. **Update `offset` and `size` for each patched file** inside the
   parsed header JSON.
4. **Rewrite the pickle header** with the new JSON, adding 4-byte
   alignment padding so the outer structure stays valid.

Concretely, from `patch_asar.js`:

```
newHSize    = length of new header JSON
nPad        = (4 - (newHSize % 4)) % 4
innerPayload = 4 + newHSize + nPad
innerTotal   = 4 + innerPayload
newDataStart = 16 + newHSize + nPad
```

The first 16 bytes of the archive encode these four `UInt32LE`
values. The rebuild reserves the original data block and simply
concatenates the patched files after it.

---

## How to test / rebuild

Prerequisites:
- Node.js 20 or newer (tested on Node 24 on Windows 11).
- `npm install` in the repo root — the upstream `package.json`
  already lists Playwright; `@electron/asar` is a small extra
  dependency that `patch_asar.js` uses.
- The original `resources/app.asar.bak` (an untouched copy of the
  shipped v1.0.8 `app.asar`) must exist next to the patch script.
  If it's missing, copy the pristine `app.asar` from a fresh
  install to `app.asar.bak` **before** running the patcher —
  otherwise you'll rebuild against an already-modified archive.

Rebuild the asar from the backup + your local patches:

```
node patch_asar.js
```

The script prints each patched file's original offset/size and the
new offset/size, plus a set of pickle-header verification bytes at
the end. If those match the "expected" values, the rebuild is sound.

Launch the app (`MATRIXblock Mini R4.exe` on Windows) and verify it
opens. For an automated sanity check:

```
node test_app.js
```

The Playwright smoke test opens the app, waits for full
initialization, and asserts on: window title, canvas count (Blockly
renders to canvas), nav elements, and console errors. Exits with
"STATUS: OK" on success.

---

## Contributing another locale

Everything AstroGenius adds is designed to be extended with a new
language by editing **three self-contained maps**, all with matching
`en` / `pt-BR` keys as templates. Adding Spanish (`es-ES`), for
example, is roughly a 10-minute exercise:

**1. Tab bar, dialogs, banners** —
   `resources/app_src/views/main.html`, `STRINGS` map inside the
   tab-manager IIFE:

```javascript
const STRINGS = {
  en:      { untitled: 'Untitled', newTab: 'New tab', ... },
  'pt-BR': { untitled: 'Sem título', newTab: 'Nova aba', ... },
  'es-ES': { untitled: 'Sin título', newTab: 'Nueva pestaña', ... },
};
```

**2. Modal HTML texts (About, MyBlock, Learning Resources, DFU)** —
   same file, `MODAL_STRINGS` map immediately below:

```javascript
const MODAL_STRINGS = {
  en:      { 'astro-about-title': 'About Software', ... },
  'pt-BR': { 'astro-about-title': 'Sobre o Programa', ... },
  'es-ES': { 'astro-about-title': 'Acerca del Software', ... },
};
```

Both maps are re-applied on every language-dropdown click, so the
switch is live — no reload needed.

**3. Block dropdown labels (Brake/Coast, Left/Right, colors, etc.)** —
   `resources/app_src/blockly-core/msg/scratch_msgs.js`, at the end
   of the file:

```javascript
Blockly.ScratchMsgs.astroLocales = {
  'en':    { BRAKE: 'Brake',  COAST: 'Coast', LEFT: 'Left', ... },
  'pt-BR': { BRAKE: 'Freio',  COAST: 'Livre', LEFT: 'Esquerda', ... },
  'es-ES': { BRAKE: 'Freno',  COAST: 'Libre', LEFT: 'Izquierda', ... },
};
```

Blocks in `blockly-core/blocks/_mini.js` reference these labels via
`AG('KEY')`, which reads the current locale off
`Blockly.ScratchMsgs.currentLocale_` and falls back to English for
any missing key.

**Full block localization** (the ~300-key locale used by Blockly
itself for setup/loop/if/repeat/etc.) is a separate exercise:
append a `Blockly.ScratchMsgs.locales['es-ES'] = { ... }` block to
the same `scratch_msgs.js` mirroring the pt-BR block. Also add the
new language to the dropdown menu — see the pt-BR precedent in the
obfuscated `app.compressed.js`.

Rebuild with `node patch_asar.js` and relaunch. That's it.

---

## Version history

See [CHANGELOG.md](CHANGELOG.md).

---

## License

Original MATRIXblock Mini R4 © K K INTELLIGENT TECHNOLOGY INC.
Modifications documented here are contributed back to the MATRIX
team under the same terms.
