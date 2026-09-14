#!/usr/bin/env pwsh
#
# classroom-cli uninstaller (PowerShell — Windows, macOS, Linux)
#
# Usage:
#   iwr -useb https://raw.githubusercontent.com/paoloose/google-classroom-cli/main/scripts/uninstall.ps1 | iex
#   ./scripts/uninstall.ps1 [-Purge] [-InstallDir <path>]
#

[CmdletBinding()]
param(
  [switch]$Purge,
  [string]$InstallDir = "",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$AppName = "classroom-cli"
$AppBin  = "classroom"
$BinExt  = if ($IsWindows) { ".exe" } else { "" }

if (-not $InstallDir) {
  if ($env:CLASSROOM_CLI_HOME) {
    $InstallDir = $env:CLASSROOM_CLI_HOME
  } elseif ($IsWindows) {
    $InstallDir = Join-Path $env:LOCALAPPDATA $AppName
  } else {
    $InstallDir = Join-Path $HOME ".config/$AppName"
  }
}

$RepoDir     = Join-Path $InstallDir "repo"
$BinDir      = Join-Path $InstallDir "bin"
$BinPath     = Join-Path $BinDir "$AppBin$BinExt"
$CmdShim     = "$BinPath.cmd"
$VersionFile = Join-Path $RepoDir ".classroom-cli-version"

if ($DryRun) {
  Write-Host "[dry-run] install-dir = $InstallDir"
  Write-Host "[dry-run] repo-dir    = $RepoDir"
  Write-Host "[dry-run] bin-path    = $BinPath"
  Write-Host "[dry-run] purge       = $Purge"
  Write-Host "[dry-run] would remove repo and binary launchers"
  if ($Purge) {
    Write-Host "[dry-run] would purge all configs and sessions"
  }
  exit 0
}

Write-Host "→ Uninstalling $AppName…"

# Remove binary symlink / shim
if (Test-Path $BinPath) {
  Remove-Item -Path $BinPath -Force
  Write-Host "✔ Removed binary: $BinPath"
}
if (Test-Path $CmdShim) {
  Remove-Item -Path $CmdShim -Force
  Write-Host "✔ Removed binary shim: $CmdShim"
}

# Remove repo
if (Test-Path $RepoDir) {
  Remove-Item -Path $RepoDir -Recurse -Force
  Write-Host "✔ Removed repo files: $RepoDir"
}

if (Test-Path $VersionFile) {
  Remove-Item -Path $VersionFile -Force
}

if ($Purge) {
  Write-Host "→ Purging configuration and credentials from $InstallDir…"
  if (Test-Path $InstallDir) {
    Remove-Item -Path $InstallDir -Recurse -Force
  }
  Write-Host "✔ Successfully purged $InstallDir"
} else {
  if ((Test-Path $BinDir) -and ((Get-ChildItem $BinDir).Count -eq 0)) {
    Remove-Item -Path $BinDir -Force
  }
  Write-Host "✔ Uninstalled $AppName binary."
  Write-Host "ℹ Configuration and credentials preserved at: $InstallDir"
  Write-Host "  (Pass -Purge to remove credentials and configuration as well)"
}
