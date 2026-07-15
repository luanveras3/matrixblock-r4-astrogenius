# MATRIXblock Mini R4 — AstroGenius Fork

Community-maintained fork of MATRIXblock Mini R4 v1.0.8 with quality-of-life
improvements targeted at classroom use, developed by the AstroGenius Team
(a Brazilian robotics team, maintainer: Luan Veras).

Every change is applied surgically to the shipped `app.asar` (see
[Rebuild strategy](#rebuild-strategy)) — the original binary is never
modified in-place, and native modules (serialport, DFU) are left
untouched in `app.asar.unpacked/`.

Latest stable git tag: **v3.2-stable**. Additional features on the
default branch since that tag: C++ code mode, `.ino` export, and a
fully bilingual runtime i18n layer (see [CHANGELOG.md](CHANGELOG.md)
for the unreleased entries).

---

## What was added

### Portuguese (pt-BR) localization
- Full `pt-BR` locale added to `blockly-core/msg/scratch_msgs.js`
  (~300 keys)
- `pt-BR` option appended to the language dropdown in the obfuscated
  `app.compressed.js`
- Block dropdown labels translated inside
  `blockly-core/blocks/_mini.js` (Brake/Coast → Freio/Livre,
  degrees/seconds → graus/segundos, colors, directions, etc.). Only
  the display label is translated; the internal code (second element
  of each `[label, code]` pair) is preserved intact, so the Arduino
  code generator is unaffected.
- All modal dialogs in `views/main.html` translated: My Block Builder,
  About, Learning Resources (with all 6 example titles), Firmware
  Update Utility
- Terminology fix: "Motor CC" → "Motor DC" (8 occurrences), which is
  the correct Portuguese term
- Portuguese examples copied to `arduino/blocks_examples/pt-BR/`

### Multi-tab editor
- Each open project lives in a separate tab, rendered in a tab bar
  between the nav and the workspace
- Green (`#008184`) styling to match the app's identity
- Active tab has a white underline; inactive tabs slightly transparent
- Close button per tab; "+" button on the right to open a new tab

### Auto-save + session recovery
- Every 30 seconds, if the active tab has a file path bound to it,
  the app triggers Save silently
- On every save/open/close/`beforeunload`, the full session state is
  persisted to `localStorage` (key `astro-session-v1`) — tab list,
  active tab, per-tab XML, per-tab dirty flag
- On launch, if a session from the last 24h exists AND has meaningful
  content (unsaved changes OR real file paths), the user is offered a
  restore prompt via SweetAlert2

### Unsaved-changes indicator
- Yellow dot (●) appears in the tab name when the workspace has
  changes since the last save
- Dirty detection uses Blockly's `addChangeListener`, filtering out
  UI-only events (viewport, selection, click, drag)
- Closing a dirty tab prompts for confirmation

### "Open file" always opens in a new tab
- Clicking File → Open (or `Ctrl+O`) creates a fresh tab with the
  opened file, preserving the previously active tab untouched
- The current tab's XML is snapshotted BEFORE the file dialog opens
  (the app's own IPC listener runs before ours and would otherwise
  replace the workspace before we could snapshot)

### C++ code mode (writable Monaco editor)
- Toggle button `</> Code` in the tab bar (per-tab state).
- When enabled, the Monaco C++ editor becomes writable and the block
  workspace is visually locked (grayscale + `pointer-events: none`),
  with a yellow banner across the top explaining the state.
- Monaco's `setValue` is wrapped as a no-op while code mode is active
  so Blockly's automatic code regeneration cannot clobber the user's
  manual edits.
- Compile and Upload transparently use the manually edited C++ —
  the app's own compile method already reads directly from
  `editor.getValue()`, so no IPC interception is needed.
- Per-tab `codeMode` and `cppCode` are persisted in the session
  snapshot; switching between tabs restores each one's mode.
- Both directions surface a SweetAlert confirmation (enabling warns
  about frozen blocks; disabling warns manual edits will be discarded).

### Export current sketch as .ino
- New File-menu entry "Export as .ino" plus `Ctrl+E` shortcut.
- Reads `editor.getValue()` from Monaco (works in both block mode
  and code mode) and triggers a native save dialog via a hidden
  `<a download>` element that Electron intercepts.
- Suggested filename is derived from the active tab's path or name
  (`Project.mbr4` → `Project.ino`), stripping the extension and
  sanitizing non-word characters.

### Keyboard shortcuts
| Shortcut       | Action                              |
| -------------- | ----------------------------------- |
| `Ctrl+S`       | Save                                |
| `Ctrl+Shift+S` | Save As                             |
| `Ctrl+O`       | Open (into a new tab)               |
| `Ctrl+T`       | New tab                             |
| `Ctrl+W`       | Close active tab                    |
| `Ctrl+E`       | Export current sketch as `.ino`     |
| `Ctrl+Shift+N` | New project                         |

### Fully bilingual UI (English default + pt-BR overrides)
- Every added user-facing string — tab bar, dialogs, banners,
  modal HTML content, block dropdown labels — resolves against the
  current locale at render time and falls back to English for any
  missing key.
- Three self-contained maps hold the translations
  (`STRINGS`, `MODAL_STRINGS`, `astroLocales`); see
  [Contributing another locale](#contributing-another-locale).
- HTML defaults are English; pt-BR overrides are applied by an
  early `applyModalStrings()` call so pt-BR users don't see an
  English flash on start-up.
- Language switches from the app's own dropdown are picked up live
  via a delegated click listener — no reload needed.

---

## Repository layout

```
matrixblock-r4/
├── README.md, CHANGELOG.md
├── .gitignore                       # whitelist: only tracks changed files
├── patch_asar.js                    # surgical asar rebuilder
├── test_app.js                      # Playwright smoke test
├── resources/
│   ├── app.asar                     # generated by patch_asar.js
│   ├── app.asar.bak                 # original v1.0.8 asar (input)
│   ├── app.asar.unpacked/           # native modules (untouched)
│   └── app_src/                     # patched source files
│       ├── app.compressed.js
│       ├── blockly-core/
│       │   ├── blocks/_mini.js
│       │   └── msg/scratch_msgs.js
│       └── views/main.html
└── arduino/
    └── blocks_examples/pt-BR/       # translated examples
```

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
