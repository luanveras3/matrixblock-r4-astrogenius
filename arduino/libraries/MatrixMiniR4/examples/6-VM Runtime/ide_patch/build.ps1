<#
    build.ps1 -- apply the BLE runtime IDE patch to MATRIXblock's app.asar.

    Steps:
      1. Ensure @electron/asar is installed under $env:TEMP\asar-tmp; install if not.
      2. Extract $Source app.asar to a temp working tree.
      3. Overlay ide_patch/blockly-core/* onto blockly-core/ in the tree.
      4. Idempotently inject a <script> tag for ble_upload.js into views/main.html.
      5. Repack to $Target.

    The USB compile+upload path is untouched. This patch only adds:
      - blockly-core/bytecode.js
      - blockly-core/generator_bytecode/*.js
      - blockly-core/ble_upload.js
      - replaces blockly-core/_BlocksAutoLoad.js with the extended loader
      - adds one <script> include to views/main.html

    Run from any directory. Requires Node.js on PATH.
    NOTE: this file is ASCII-only on purpose so PS 5.1 does not misparse it.
#>
param(
    [string]$Source = "C:\matrixblock-r4\resources\app.asar",
    [string]$Target = "C:\matrixblock-r4\resources\app.asar",
    [switch]$KeepWork
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PatchDir  = Join-Path $ScriptDir 'blockly-core'

if (-not (Test-Path $PatchDir)) {
    throw "ide_patch/blockly-core not found at $PatchDir"
}
if (-not (Test-Path $Source)) {
    throw "Source app.asar not found: $Source"
}

# ---- 1. asar tooling -------------------------------------------------------
$AsarRoot = Join-Path $env:TEMP 'asar-tmp'
$AsarBin  = Join-Path $AsarRoot 'node_modules\@electron\asar\bin\asar.mjs'
if (-not (Test-Path $AsarBin)) {
    New-Item -ItemType Directory -Force -Path $AsarRoot | Out-Null
    Write-Host "Installing @electron/asar into $AsarRoot ..."
    & npm install --no-save --prefix $AsarRoot '@electron/asar' | Out-Null
}

# ---- 2. Extract app.asar to a clean work dir -------------------------------
$WorkDir = Join-Path $env:TEMP 'mbr4-ide-build'
if (Test-Path $WorkDir) { Remove-Item -Recurse -Force $WorkDir }
Write-Host "Extracting $Source to $WorkDir ..."
& node $AsarBin extract $Source $WorkDir

# ---- 3. Overlay patch files ------------------------------------------------
$DestBlockly = Join-Path $WorkDir 'blockly-core'
$DestByGen   = Join-Path $DestBlockly 'generator_bytecode'
New-Item -ItemType Directory -Force -Path $DestByGen | Out-Null

Write-Host "Overlaying patch files..."
Copy-Item -Force (Join-Path $PatchDir 'bytecode.js')             $DestBlockly
Copy-Item -Force (Join-Path $PatchDir 'ble_upload.js')           $DestBlockly
Copy-Item -Force (Join-Path $PatchDir 'arduino_ble_wrapper.js')  $DestBlockly
Copy-Item -Force (Join-Path $PatchDir '_BlocksAutoLoad.js')      $DestBlockly
Copy-Item -Force (Join-Path $PatchDir 'generator_bytecode\*')    $DestByGen

# ---- 4. Inject script tag into views/main.html (idempotent) ---------------
$MainHtml = Join-Path $WorkDir 'views\main.html'
if (-not (Test-Path $MainHtml)) {
    throw 'views/main.html not found in extracted tree.'
}

# Build the strings without embedding raw < or > inside PS-parsed literals.
$q         = [char]0x22
$lt        = [char]0x3C
$gt        = [char]0x3E
$marker    = $lt + '!-- BLE runtime uploader (added by ide_patch/build.ps1) --' + $gt
$scriptTag = $lt + 'script type=' + $q + 'text/javascript' + $q +
             ' src=' + $q + '../blockly-core/ble_upload.js' + $q + $gt +
             $lt + '/script' + $gt
$injectBlock = "`t" + $marker + "`n`t" + $scriptTag + "`n"

# Read as UTF-8 explicitly; never round-trip via CP1252.
$bytes = [System.IO.File]::ReadAllBytes($MainHtml)
$html  = [System.Text.Encoding]::UTF8.GetString($bytes)

if ($html.Contains($marker)) {
    Write-Host 'main.html already patched; skipping HTML edit.'
} else {
    $needle = $lt + '/html' + $gt
    $idx = $html.LastIndexOf($needle)
    if ($idx -lt 0) { throw 'Could not find closing html tag in main.html.' }
    $patched = $html.Substring(0, $idx) + $injectBlock + "`n" + $html.Substring($idx)
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllBytes($MainHtml, $utf8NoBom.GetBytes($patched))
    Write-Host 'Injected BLE uploader script tag into main.html.'
}

# ---- 4b. Inject Web Bluetooth chooser into main.js (idempotent) -----------
# Electron will not resolve navigator.bluetooth.requestDevice() unless the
# main process handles the 'select-bluetooth-device' event. We auto-select
# the first advertised MATRIX-R4-Runtime so the click-to-upload flow is
# invisible to the user (no native picker dialog).
$MainJs = Join-Path $WorkDir 'main.js'
if (-not (Test-Path $MainJs)) {
    throw 'main.js not found in extracted tree.'
}

$jsMarker = '// BEGIN BLE runtime chooser (ide_patch/build.ps1)'
$jsEnd    = '// END BLE runtime chooser'
$jsInject = @'

    // BEGIN BLE runtime chooser (ide_patch/build.ps1)
    this.win.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
      // Only auto-select when there is exactly one MATRIX-* hub in range.
      // 0 hubs -> keep scanning (Chromium times out on its own).
      // 2+ hubs -> do NOT preventDefault, so Electron shows its native picker
      //           with the (already-namePrefix-filtered) hub list and the
      //           user picks which one they want. This is the recovery path
      //           for a classroom with several MATRIX-* devices in the air.
      const matches = deviceList.filter(d => (d.deviceName || '').startsWith('MATRIX-'));
      if (matches.length === 1) {
        event.preventDefault();
        callback(matches[0].deviceId);
      }
    });
    // END BLE runtime chooser

'@

$jsBytes = [System.IO.File]::ReadAllBytes($MainJs)
# Note: PowerShell variables are case-insensitive, so we cannot name this
# $mainJs -- it would clobber $MainJs (the file path). Use $mainJsSrc instead.
$mainJsSrc = [System.Text.Encoding]::UTF8.GetString($jsBytes)

# If the marker is already present, strip everything between BEGIN and END
# (inclusive) and reinsert -- this lets us update the injected block by
# editing $jsInject above without leaving stale copies behind.
if ($mainJsSrc.Contains($jsMarker)) {
    $beginIdx = $mainJsSrc.IndexOf($jsMarker)
    $endIdx   = $mainJsSrc.IndexOf($jsEnd, $beginIdx)
    if ($endIdx -lt 0) { throw 'main.js has BEGIN marker but no END marker.' }
    $endLineEnd = $mainJsSrc.IndexOf("`n", $endIdx)
    if ($endLineEnd -lt 0) { $endLineEnd = $mainJsSrc.Length - 1 }
    # Include leading whitespace on the BEGIN line so we don't leave an
    # orphan indent.
    $lineStart = $mainJsSrc.LastIndexOf("`n", $beginIdx)
    if ($lineStart -lt 0) { $lineStart = -1 }
    $mainJsSrc = $mainJsSrc.Substring(0, $lineStart + 1) +
                 $mainJsSrc.Substring($endLineEnd + 1)
    Write-Host 'main.js: existing chooser block removed for replacement.'
}

# Inject just after the "createMainWindow" body's `this.win.on('closed', ...)`
# block. We look for the DevTools comment which sits right before the
# closing brace of createMainWindow.
$needle = "// this.win.webContents.openDevTools"
$idx = $mainJsSrc.IndexOf($needle)
if ($idx -lt 0) {
    throw 'Could not find DevTools anchor in main.js.'
}
$eol = $mainJsSrc.IndexOf("`n", $idx)
if ($eol -lt 0) { throw 'Malformed main.js anchor.' }
$patched = $mainJsSrc.Substring(0, $eol + 1) + $jsInject + $mainJsSrc.Substring($eol + 1)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllBytes($MainJs, $utf8NoBom.GetBytes($patched))
Write-Host 'Injected select-bluetooth-device handler into main.js.'

# ---- 5. Repack -------------------------------------------------------------
if (Test-Path $Target) {
    $backup = "$Target.pre-ble.bak"
    if (-not (Test-Path $backup)) {
        Write-Host "Backing up existing $Target to $backup"
        Copy-Item -Force $Target $backup
    }
}

Write-Host "Repacking to $Target ..."
& node $AsarBin pack $WorkDir $Target
Write-Host 'Done.'

if (-not $KeepWork) {
    Remove-Item -Recurse -Force $WorkDir
} else {
    Write-Host "Work tree kept at $WorkDir"
}
