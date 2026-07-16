# Installing AstroGenius v3.4.1 on a fresh MATRIXblock Mini R4

Step-by-step guide for applying the AstroGenius fork (built on top of
MATRIXblock Mini R4 v1.0.8) to a clean install. Tested on Windows 11
with Node 24.

The release notes mention `npm install`, but `patch_asar.js` only uses
`fs` and `path` from the Node standard library — **npm is optional**
and only needed if you want to run the Playwright smoke test.

---

## Prerequisites

1. **MATRIXblock Mini R4 v1.0.8** already installed. The installer's
   default path is `C:\matrixblock-r4\`. If you installed it somewhere
   else, adjust the paths below (or edit `patch_asar.js`, see step 5).
2. **Node.js 20+** (`node --version` should respond). Download from
   https://nodejs.org if needed.
3. **Git** (`git --version`). Download from https://git-scm.com.
4. The app **must be closed** during the entire process — while it's
   running, Windows locks `app.asar` and the patcher will fail.

---

## Step 1 — Clone the fork

Pick a working directory **outside** the app folder (this guide uses
`C:\astrogenius-work\src`):

```powershell
git clone https://github.com/luanveras3/matrixblock-r4-astrogenius C:\astrogenius-work\src
```

The clone contains:

```
C:\astrogenius-work\src\
├── patch_asar.js                     # surgical asar rebuilder
├── test_app.js                       # Playwright smoke test (optional)
├── README.md, CHANGELOG.md
├── resources\
│   └── app_src\                      # patched source files
│       ├── app.compressed.js
│       ├── blockly-core\blocks\_mini.js
│       ├── blockly-core\msg\scratch_msgs.js
│       └── views\main.html
└── arduino\blocks_examples\pt-BR\    # translated examples
```

---

## Step 2 — Back up the original `app.asar`

`patch_asar.js` **always reads from `app.asar.bak`**. If you run the
patcher against an already-patched `app.asar`, you'll double-apply the
changes and corrupt the archive. Always start from a clean backup.

```powershell
Copy-Item 'C:\matrixblock-r4\resources\app.asar' `
          'C:\matrixblock-r4\resources\app.asar.bak' -Force
```

Confirm both files have the same size (~113 MB / 113,113,172 bytes on v1.0.8).

> If you ever reinstall the app, delete the old `app.asar.bak` before
> re-copying — that keeps the backup aligned with the installed version.

---

## Step 3 — Copy the patched sources into the install

`patch_asar.js` has hard-coded paths pointing at the install directory —
it reads patched sources from `C:\matrixblock-r4\resources\app_src\`.
Copy them from the clone:

```powershell
Copy-Item 'C:\astrogenius-work\src\resources\app_src' `
          'C:\matrixblock-r4\resources\app_src' -Recurse -Force
```

Plus the Portuguese examples (optional but recommended):

```powershell
Copy-Item 'C:\astrogenius-work\src\arduino\blocks_examples\pt-BR' `
          'C:\matrixblock-r4\arduino\blocks_examples\pt-BR' -Recurse -Force
```

---

## Step 4 — Run the patcher

```powershell
node C:\astrogenius-work\src\patch_asar.js
```

Expected output (sizes may drift as the release evolves):

```
Reading original asar backup...
origHSize    : 598616
origDataStart: 598632
origDataSize : 112514540
Original app.compressed.js               -> offset: 100049737 size: 100801
Patched  app.compressed.js               -> size: 100903
Original blockly-core/msg/scratch_msgs.js -> offset: 108581257 size: 85156
Patched  blockly-core/msg/scratch_msgs.js -> size: 120098
Original blockly-core/blocks/_mini.js    -> offset: 108074607 size: 121048
Patched  blockly-core/blocks/_mini.js    -> size: 126129
Original views/main.html                 -> offset: 111773399 size: 17308
Patched  views/main.html                 -> size: 49122
...
Done.
Verify byte 0-3 : 4 (expected 4)
Verify byte 4-7 : 598628 (expected 598628 )
Verify byte 8-11: 598624 (expected 598624 )
Verify byte 12-15: 598617 (expected 598617 )
```

The four `Verify` lines at the end must match their `expected` values.
If they do, `app.asar` was rewritten correctly.

---

## Step 5 — (Optional) If your install is NOT at `C:\matrixblock-r4\`

`patch_asar.js` has three hard-coded paths near the top:

```javascript
const BACKUP  = 'C:/matrixblock-r4/resources/app.asar.bak';
const OUT     = 'C:/matrixblock-r4/resources/app.asar';
const SRC_DIR = 'C:/matrixblock-r4/resources/app_src';
```

Edit those three lines to point at your install before running.

---

## Step 6 — Verify

Launch `C:\matrixblock-r4\MATRIXblock Mini R4.exe` and check:

- Green (`#008184`) tab bar between the menu and the workspace.
- Language toggle in the navbar — should list English and
  Português (Brasil).
- File menu has "Export as .ino" (`Ctrl+E`).
- The `</> Code` button in the tab bar switches to writable C++ mode.

Automated smoke test (optional, requires Playwright):

```powershell
cd C:\astrogenius-work\src
npm install playwright
node test_app.js
```

Expect `STATUS: OK - app opened correctly` at the end.

---

## Rolling back

Close the app first (Task Manager → end `MATRIXblock Mini R4.exe` if
it's still running — while it's alive, Windows keeps `app.asar` locked
and the copy silently no-ops), then restore the backup:

```powershell
Copy-Item 'C:\matrixblock-r4\resources\app.asar.bak' `
          'C:\matrixblock-r4\resources\app.asar' -Force
```

From v3.4.1 onward this is all that's needed — the fork keeps its
language preference in a fork-scoped `astro-lang` localStorage key
and never writes to the pristine app's `lang` key, so pristine boots
cleanly after the swap.

**Rolling back from a ≤v3.4 install** — an older fork wrote its
language preference to `localStorage.lang`, which pristine v1.0.8
reads on startup. Pristine's Blockly is missing a few pt-BR category
translations, so if `lang` is still set to `pt-BR` after the swap the
category names render as raw `%{BKY_CATEGORY__MINI}` placeholders.
Wipe the storage before launching:

```powershell
Remove-Item 'C:\Users\%USERNAME%\AppData\Roaming\MATRIXblock Mini R4\Local Storage' -Recurse -Force
```

The pristine app rebuilds this folder on next launch.

---

## Common errors

**`Cannot find … in header`** — `app_src/` doesn't match the shipped
`app.asar`. Confirm the backup is from v1.0.8 and the `app_src/` tree
is intact.

**`BOM detected in …`** — one of the files in `app_src/` was saved as
UTF-8 with BOM (Windows Notepad does this). Reopen and save as UTF-8
without BOM (VS Code: bottom-right corner → "UTF-8 with BOM" → "Save
with Encoding" → "UTF-8").

**App opens blank / crashes on start** — almost always a corrupted
`app.asar`: rerun the patcher against a clean `.bak`.

**"EBUSY" or "file in use"** — the app was still running. Kill it
from Task Manager (process `MATRIXblock Mini R4`) and try again.

**Ran the patcher twice** — the generated `app.asar` is now based on
itself. Restore `.bak` over `app.asar` and run the patcher ONCE.

---

## One-liner (once you know what you're doing)

```powershell
Copy-Item C:\matrixblock-r4\resources\app.asar C:\matrixblock-r4\resources\app.asar.bak -Force; `
Copy-Item C:\astrogenius-work\src\resources\app_src C:\matrixblock-r4\resources\app_src -Recurse -Force; `
node C:\astrogenius-work\src\patch_asar.js
```
