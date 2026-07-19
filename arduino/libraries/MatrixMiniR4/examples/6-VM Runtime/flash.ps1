# flash.ps1 -- compile and upload MiniR4_BLE_Runtime.ino to the R4 WiFi.
#
# Uses the self-contained arduino-cli toolchain shipped alongside the
# MATRIXblock IDE at C:\matrixblock-r4\arduino\ (bundled arduino-cli.exe,
# arduino-cli.yaml, and the full MatrixMiniR4 / ArduinoBLE libraries).
# The runtime files in that folder are kept identical to this git checkout;
# if you edit MiniR4BLERuntime.{h,cpp} here, sync them to the toolchain
# folder first (or add -Sync).
#
# Usage:
#   .\flash.ps1                  # auto-detect port, compile + upload
#   .\flash.ps1 -Port COM10      # force a specific port
#   .\flash.ps1 -CompileOnly     # dry run, no upload
#   .\flash.ps1 -Sync            # copy runtime + sketch from repo -> toolchain before build

[CmdletBinding()]
param(
    [string]$Port,
    [switch]$CompileOnly,
    [switch]$Sync,
    [string]$Fqbn = "arduino:renesas_uno:unor4wifi",
    [string]$ToolchainRoot = "C:\matrixblock-r4\arduino"
)

$ErrorActionPreference = "Stop"

$cli        = Join-Path $ToolchainRoot "arduino-cli.exe"
$cliYaml    = Join-Path $ToolchainRoot "arduino-cli.yaml"
$sketchDir  = Join-Path $ToolchainRoot "libraries\MatrixMiniR4\examples\6-VM Runtime\MiniR4_BLE_Runtime"
$buildDir   = Join-Path $PSScriptRoot ".build"

# Files to keep in sync from git checkout -> toolchain.
$repoRoot   = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path  # -> arduino/
$syncPairs  = @(
    @{ Src = "libraries\MatrixMiniR4\src\Modules\MiniR4BLERuntime.h";                                    Dst = "libraries\MatrixMiniR4\src\Modules\MiniR4BLERuntime.h" },
    @{ Src = "libraries\MatrixMiniR4\src\Modules\MiniR4BLERuntime.cpp";                                  Dst = "libraries\MatrixMiniR4\src\Modules\MiniR4BLERuntime.cpp" },
    @{ Src = "libraries\MatrixMiniR4\examples\6-VM Runtime\MiniR4_BLE_Runtime\MiniR4_BLE_Runtime.ino";   Dst = "libraries\MatrixMiniR4\examples\6-VM Runtime\MiniR4_BLE_Runtime\MiniR4_BLE_Runtime.ino" }
)

foreach ($p in @($cli, $cliYaml, $sketchDir)) {
    if (-not (Test-Path $p)) { throw "toolchain path missing: $p" }
}

Write-Output "arduino-cli: $cli"
Write-Output "config:      $cliYaml"
Write-Output "sketch:      $sketchDir"
Write-Output "fqbn:        $Fqbn"

if ($Sync) {
    Write-Output "--- sync repo -> toolchain ---"
    foreach ($pair in $syncPairs) {
        $src = Join-Path $repoRoot $pair.Src
        $dst = Join-Path $ToolchainRoot $pair.Dst
        Write-Output "  $($pair.Src)"
        Copy-Item -Path $src -Destination $dst -Force
    }
}

if (-not $Port -and -not $CompileOnly) {
    Push-Location $ToolchainRoot
    try {
        $boards = & $cli --config-file $cliYaml board list --format json | ConvertFrom-Json
    } finally { Pop-Location }
    $match = $boards.detected_ports | Where-Object {
        $_.matching_boards -and ($_.matching_boards.fqbn -contains $Fqbn)
    } | Select-Object -First 1
    if ($match) {
        $Port = $match.port.address
        Write-Output "auto-detected port: $Port"
    } else {
        throw "No R4 WiFi detected. Pass -Port COMx explicitly."
    }
}

Push-Location $ToolchainRoot
try {
    Write-Output "--- compile ---"
    & $cli --config-file $cliYaml compile `
        --fqbn $Fqbn `
        --build-path $buildDir `
        --warnings default `
        $sketchDir
    if ($LASTEXITCODE -ne 0) { throw "compile failed" }

    if ($CompileOnly) {
        Write-Output "compile-only: skipping upload"
        return
    }

    Write-Output "--- upload to $Port ---"
    & $cli --config-file $cliYaml upload `
        --fqbn $Fqbn `
        --port $Port `
        --input-dir $buildDir `
        $sketchDir
    if ($LASTEXITCODE -ne 0) { throw "upload failed" }
} finally { Pop-Location }

Write-Output "done."
