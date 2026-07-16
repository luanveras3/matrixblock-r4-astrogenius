# Changelog

All notable changes to the AstroGenius fork of MATRIXblock Mini R4.
Based on upstream v1.0.8. Format loosely inspired by
[Keep a Changelog](https://keepachangelog.com/).

---

## [v3.4-stable] — 2026-07-16

### Added
- **Recent Files** section in the File menu. Records the last 10 file
  paths the user actually opens or saves (localStorage key
  `astro-recent-v1`) and shows the top 5 as clickable entries between
  Export as .ino and the Update FW divider. Clicking one reads the
  file with `fs.readFileSync` and reuses the Ctrl+O flow so it lands
  in a new tab. Missing paths are dropped from the list with a
  SweetAlert explaining what happened. Bilingual (EN + pt-BR).
- **`INSTALL.md`** — end-user walkthrough for applying the fork to a
  clean v1.0.8 install. Covers backup, `app_src` copy, patcher run,
  verification, rollback, and the common errors (BOM, EBUSY,
  double-patch).
- **`RELEASE.md`** — maintainer-facing setup guide for the CI
  pipeline: private vendor repo, fine-grained PAT, Actions
  secrets/variables, per-tag release checklist.
- **CI release workflow** (`.github/workflows/release.yml`). On any
  `v*` tag push, fetches the pristine v1.0.8 `app.asar` from a private
  vendor repo, runs `patch_asar.js` against it, and attaches the
  patched `app.asar` to the release. End users can install by
  downloading one file instead of running Node locally.

### Changed
- `patch_asar.js` now reads `BACKUP`, `OUT`, and `SRC_DIR` from env
  vars (`ASAR_BACKUP`, `ASAR_OUT`, `ASAR_SRC_DIR`) with the previous
  Windows install paths as fallbacks. Local rebuilds keep working
  with zero config; CI points at repo-relative paths.

---

## [v3.3-stable] — 2026-07-15

### Added
- Bilingual C++ code mode (per-tab writable Monaco editor). Toggle
  in the tab bar; SweetAlert confirmation on both directions.
  Blockly workspace is visually locked while code mode is active.
  Compile and Upload transparently use the manually edited code
  because the app's compile method already reads directly from
  Monaco's `getValue()`.
- Export current sketch as `.ino` — new File-menu entry plus
  `Ctrl+E` shortcut. Uses `<a download>` so Electron shows a native
  save-as dialog with a filename derived from the tab.
- Runtime i18n layer for all V3.1 modal HTML content plus the
  Export menu label. A `MODAL_STRINGS` map with `en` defaults and
  `pt-BR` overrides is re-applied after every language-dropdown
  click, driven by clicks delegated on `#langDropDownMenu`.
- Runtime i18n for the hardcoded dropdown labels inside
  `blockly-core/blocks/_mini.js`. A new `AG('KEY')` helper
  (installed on `window` from `scratch_msgs.js`) resolves the
  active locale off `Blockly.ScratchMsgs.currentLocale_` and falls
  back to English for unknown keys. All 69 previously-hardcoded
  pt-BR labels are now `AG(...)` calls.
- Contributor documentation: `README.md` now explains that adding
  another locale (e.g. Spanish) is a three-map edit — `STRINGS`
  and `MODAL_STRINGS` in `main.html`, `astroLocales` in
  `scratch_msgs.js` — and takes about ten minutes.

### Fixed
- The Export-as-`.ino` menu label was only translated once at init
  and never refreshed on locale change. It is now part of
  `MODAL_STRINGS` and follows the current locale live.
- Static HTML defaults for the About / MyBlock / Learning Resources /
  Firmware Update modals were hardcoded in pt-BR. English users saw
  Portuguese text flash for ~2.5 s until the tab-manager init timer
  fired `applyModalStrings()`. HTML defaults are now English (the
  neutral fallback), and a new `bootI18nEarly()` helper runs
  `applyModalStrings()` at DOMContentLoaded plus two catch-up timers
  (400 ms, 1500 ms) so pt-BR users get their locale applied before
  Blockly finishes bootstrapping.
- `.gitignore` comments translated to English for consistency with
  the rest of the codebase.

---

## [v3.2-stable] — 2026-07-15

### Changed
- All AstroGenius-added user-facing strings are now bilingual through
  a small `STRINGS` map keyed by `Blockly.ScratchMsgs.currentLocale_`.
  English is the default; `pt-BR` overrides apply when that locale is
  selected. Verified via Playwright: switching the locale at runtime
  refreshes tab tooltips and dialog buttons.
- The i18n lookup helper is named `tr()` rather than `t()` to avoid
  shadowing the many `const t = ...` locals scattered through the
  tab-manager methods. The previous naming triggered a temporal
  dead-zone `ReferenceError` under strict mode.
- All in-file JS/CSS comments in `views/main.html` and the top-of-file
  docstring in `patch_asar.js` are now in English, prepping the
  codebase for upstream review by the MATRIX team.

### Notes
- Modal HTML content remains in pt-BR — that IS the translation
  deliverable being showcased. MATRIX's own i18n layer already
  overrides these IDs at runtime when a different locale is chosen.

---

## [V3.1] — 2026-07-15

### Added
- Portuguese translations for the remaining English modals:
  - "My Block Builder" → "Construtor de Meu Bloco" (with Number/
    Text/Logic/Tag inputs and Finish/Cancel buttons)
  - "About Software" → "Sobre o Programa" (title, description, EULA
    and licenses links)
  - "Learning Resources" → "Recursos de Aprendizagem" (title + 6
    example card titles)
  - "Mini R4 Firmware Update Utility" → "Atualizador de Firmware
    Mini R4" (all three step buttons + Close)
- Translations for hardcoded dropdown labels inside
  `blockly-core/blocks/_mini.js` (69 substitutions total):
  - Motor: Brake/Coast → Freio/Livre, degrees/seconds →
    graus/segundos
  - State: Yes/No → Sim/Não, On/Off → Ligado/Desligado
  - Direction: Left/Right → Esquerda/Direita
  - Colors: Red/Green/Blue/Hue/Saturation/Value/Cyan/Yellow/White/
    Black → Vermelho/Verde/Azul/Matiz/Saturação/Valor/Ciano/Amarelo/
    Branco/Preto
  - Sensors: Humidity → Umidade, ColorID → ID Cor
- `blockly-core/blocks/_mini.js` is now a tracked patched file; the
  `PATCHES` array in `patch_asar.js` was extended accordingly.

### Preserved
- Only the *display label* (first element of each `[label, code]`
  dropdown pair) is translated; the internal code (second element)
  stays intact. The Arduino code generator is therefore unaffected.
- Terms kept in English by design because they are the standard
  technical terminology also used in Portuguese teaching material:
  Roll/Pitch/Yaw (IMU), gamepad buttons (UP/DOWN/TRIANGLE/CIRCLE/
  CROSS/SQUARE), image-detection coordinates (X_Center, Y_Center,
  Width, Height, ID).

---

## [V3] — 2026-07-15

### Added
- **Keyboard shortcuts** (registered at capture phase so they win
  over the app's own listeners):
  - `Ctrl+S`: Save
  - `Ctrl+Shift+S`: Save As
  - `Ctrl+O`: Open (into a new tab)
  - `Ctrl+T`: New tab
  - `Ctrl+W`: Close active tab
  - `Ctrl+Shift+N`: New project
- **Unsaved-changes indicator** — a yellow dot (●) is shown in the
  tab title when there are edits since the last save. Detection uses
  `Blockly.mainWorkspace.addChangeListener`, filtering out UI-only
  event types (`UI`, `viewport_change`, `selected`, `click`, `drag`).
  Closing a dirty tab surfaces a SweetAlert2 confirmation. The
  dirty flag is cleared on save, save-as, or successful file open.
- **Session recovery** — the full tab state (list, active tab,
  per-tab XML/path/name/dirty flag, `savedAt` timestamp) is
  persisted to `localStorage` under key `astro-session-v1`. The
  persist trigger fires on auto-save, save, save-as, open, close
  tab, and `beforeunload`. On launch, if a session younger than 24h
  exists AND has unsaved changes or real file paths, a SweetAlert
  offers "Restore" or "Start fresh".

---

## [V2.3] — 2026-07-15

### Fixed
- **Tab click was doing nothing.** `dataset.tabId = "5"` creates the
  attribute `data-tab-id` (hyphenated), but the click delegator was
  matching `closest('[data-tabId]')` which selectors normalize to
  `data-tabid` (lowercase, no hyphen). Attribute names in the DOM
  differ; the selector never matched. Fixed by using
  `closest('[data-tab-id]')` and reading `dataset.tabId`. Same fix
  applied to the close button's `data-close-id`.
- **"Open file" was replacing the current tab and also creating a
  new one.** The app's own `show-open-dialog` listener is registered
  before ours (the compressed app JS loads first) and runs first,
  meaning by the time our listener ran, the workspace had already
  been replaced with the new file. Our `_saveXml()` was therefore
  snapshotting the *new* file into the *current* tab. Fix: snapshot
  the current tab's XML in the `#openNavLink` click handler, BEFORE
  the dialog opens. The new tab's XML is populated directly from
  `result.data.data` in the IPC response, so no timing window
  remains.
- **Tab bar was covering nav dropdowns.** Reduced tab bar `z-index`
  from 1050 back to 5. The dropdowns from `.navbar` (z-index 1049)
  create their own stacking context and were being covered by the
  higher tab-bar layer. The tab bar only needs to sit above the
  workspace content, not above the nav.

---

## [V2.2] — 2026-07-15

### Changed
- **Tab bar recolored** from GitHub-dark (`#0d1117`) to the app's
  identity green (`#008184`). Inactive tabs use `rgba(255,255,255,0.75)`
  text; the active tab has a solid `#fff` bottom border.
- **z-index bumped** to 1050 (later reverted in V2.3 — see above).

### Added
- **Open file → new tab (initial version).** Clicking "Abrir
  arquivo" flags `_openInNewTab = true`; the next `show-open-dialog`
  response creates a fresh tab instead of overwriting the current
  one. (Refined further in V2.3 to fix a timing bug.)

---

## [V2.1] — 2026-07-15

### Fixed
- **Tab bar was invisible.** The app's own `style.css` positions
  `.content-Div` with `position: absolute; top: 53px` (nav height),
  which sat on top of the tab bar and covered it. Fixed with a CSS
  override in `main.html` that pushes `.content-Div` to
  `top: 85px !important` (nav 53px + tab bar 32px). Playwright
  layout inspection confirmed: nav ends at y=53, tab bar spans
  y=53–85, content starts at y=85, no overlap.

---

## [V2] — 2026-07-14

### Added
- **Multi-tab editor.** Each project lives in its own tab. Tab bar
  is injected between `</nav>` and `.content-Div`. Tabs store the
  workspace XML in memory; switching tabs re-emits a fake
  `show-open-dialog` IPC event that the app's own file-load logic
  consumes to swap the workspace content. This avoids duplicating
  Blockly workspace instances.
- **Auto-save every 30 seconds.** When the active tab has a bound
  file path, `#saveNavLink` is triggered silently. A brief
  💾 timestamp indicator appears on the right side of the tab bar
  for 4 seconds after each save.
- Tab manager exposes `window._astroTabs` for debugging and for
  future extensions.

---

## [V1] — 2026-07-13

### Added
- **Portuguese (pt-BR) locale** appended to
  `blockly-core/msg/scratch_msgs.js` as
  `Blockly.ScratchMsgs.locales["pt-BR"] = { ... }` (~300 keys
  covering every block message present in the shipping locales).
- **pt-BR language option** added to the language dropdown inside
  the obfuscated `app.compressed.js`, following the existing
  `_0x353b21 / _0x4b1286` pattern used by the other locales.
- **pt-BR examples folder** — `arduino/blocks_examples/pt-BR/`
  seeded from the English examples so the "Learning Resources"
  loader finds files when pt-BR is selected.
- **Terminology fix.** "Motor CC" (a common mistranslation) →
  "Motor DC" across all 8 occurrences.

### Infrastructure
- `patch_asar.js` — asar rebuilder using the surgical-append
  strategy (keep original data section intact, append patched
  files, rewrite offsets and Chromium Pickle header with 4-byte
  padding).
- `test_app.js` — Playwright smoke test.
- `.gitignore` — whitelist model, tracking only the changed
  source files, the two scripts, and the pt-BR examples folder.
- Initial commit tagged as "AstroGenius V1".

---

## Notes on discarded approaches

For future contributors looking at the git history:

- **Rebuilding the whole asar from a temp extraction** was tried
  early. It breaks serialport and DFU because those native `.node`
  files live in `app.asar.unpacked/` and the archive references
  their positions. The surgical-append rebuild avoids this entirely
  by never touching the original data section.
- **PowerShell's default `Out-File` encoding is UTF-16 LE with BOM.**
  Writing the patched `_mini.js` or `main.html` from PowerShell
  broke everything until we switched to Node.js `Buffer.from(str,
  'utf8')` (no BOM). `patch_asar.js` now sanity-checks for a BOM
  and throws before rebuilding.
- **`ipcRenderer.emit(...)` inside the renderer** was chosen for
  cross-tab workspace loading because it fires the app's own
  `show-open-dialog` listener without a real round trip to the main
  process. A `_suppressOpen` flag prevents our own listener from
  re-processing these synthetic events as real file opens.
