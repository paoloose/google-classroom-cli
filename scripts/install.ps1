#!/usr/bin/env pwsh
#
# classroom-cli installer / updater (PowerShell — Windows, macOS, Linux).
#
# Examples (PowerShell 7+):
#   iwr -useb https://raw.githubusercontent.com/paoloose/google-classroom-cli/main/scripts/install.ps1 | iex
#   iwr -useb .../install.ps1 | iex -ArgumentList '--version','v0.0.1'
#   iwr -useb .../install.ps1 | iex -ArgumentList '--prerelease','--force'
#   iwr -useb .../install.ps1 | iex -ArgumentList '--install-dir','C:\Tools\classroom-cli'
#
# Mirrors scripts/install.sh. Same defaults, same allow-list, same layout.

[CmdletBinding()]
param(
  [string]$Version = "",
  [switch]$Prerelease,
  [string]$Channel = "stable",
  [string]$InstallDir = "",
  [switch]$Force,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# ---------- config ----------
$RepoOwner = if ($env:CLASSROOM_CLI_REPO_OWNER) { $env:CLASSROOM_CLI_REPO_OWNER } else { "paoloose" }
$RepoName  = if ($env:CLASSROOM_CLI_REPO_NAME)  { $env:CLASSROOM_CLI_REPO_NAME  } else { "google-classroom-cli" }
$Repo      = "$RepoOwner/$RepoName"
$GitHubApi = "https://api.github.com"
$GitHubDl  = "https://github.com/$Repo/releases/download"

$AppName  = "classroom-cli"
$AppBin   = "classroom"
$BinExt   = if ($IsWindows) { ".exe" } else { "" }

# Allow-list — must mirror scripts/install.sh and the release workflow.
$AllowedTargets = @(
  "linux-x64","linux-arm64",
  "darwin-x64","darwin-arm64",
  "windows-x64"
)

function Write-Usage {
@"
classroom-cli installer (PowerShell)

Usage: install.ps1 [options]

Options:
  -Version <vX.Y.Z>     Install a specific release tag (default: latest non-prerelease)
  -Prerelease           Include pre-releases when resolving 'latest'
  -Channel <name>       'stable' (default) or 'beta'
  -InstallDir <path>    Override install root
  -Force                Re-download even if the installed version matches
  -DryRun               Print actions without executing them
  -?, -Help             Show this help

Environment variables:
  CLASSROOM_CLI_HOME        Install root (overridden by -InstallDir)
  CLASSROOM_CLI_REPO_OWNER  GitHub owner
  CLASSROOM_CLI_REPO_NAME   GitHub repo
  GITHUB_TOKEN              Optional auth token for GitHub API
"@
}

if ($Channel -notin @("stable","beta")) { throw "Invalid -Channel: $Channel (expected 'stable' or 'beta')" }
if ($Channel -eq "beta") { $Prerelease = $true }

# ---------- platform detection ----------
function Get-Target {
  $os = switch ($IsWindows) {
    $true  { "windows" }
    $false { if ($IsMacOS) { "darwin" } else { "linux" } }
  }
  $arch = switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture) {
    "X64"   { "x64" }
    "Arm64" { "arm64" }
    default { throw "Unsupported architecture: $_" }
  }
  "$os-$arch"
}

$Target = Get-Target
if ($AllowedTargets -notcontains $Target) {
  throw "Target '$Target' is not in the published artifact allow-list. Supported: $($AllowedTargets -join ', ')"
}

# ---------- paths ----------
if (-not $InstallDir) {
  if ($env:CLASSROOM_CLI_HOME) { $InstallDir = $env:CLASSROOM_CLI_HOME }
  elseif ($IsWindows) {
    $InstallDir = Join-Path $env:LOCALAPPDATA $AppName
  } else {
    $InstallDir = Join-Path $HOME ".config/$AppName"
  }
}
$RepoDir     = Join-Path $InstallDir "repo"
$BinDir      = Join-Path $InstallDir "bin"
$BinPath     = Join-Path $BinDir "$AppBin$BinExt"
$VersionFile = Join-Path $RepoDir ".classroom-cli-version"

# ---------- version resolution ----------
function Resolve-Version {
  param([bool]$IncludePrerelease)

  $headers = @{ "User-Agent" = "$AppName-installer" }
  if ($env:GITHUB_TOKEN) { $headers["Authorization"] = "token $env:GITHUB_TOKEN" }

  $prereleaseQuery = if ($IncludePrerelease) { "" } else { "?per_page=50&pre_release=false" }
  $url = "$GitHubApi/repos/$Repo/releases$prereleaseQuery"

  $response = Invoke-RestMethod -Headers $headers -Uri $url -Method Get
  if (-not $response -or $response.Count -eq 0) {
    throw "No matching release found for channel '$Channel'."
  }
  return $response[0].tag_name
}

function Strip-V { param([string]$v) if ($v.StartsWith("v")) { $v.Substring(1) } else { $v } }

# Compares dotted versions: -1, 0, 1. Not a full semver comparator.
function Compare-Version {
  param([string]$A, [string]$B)
  $ap = $A.Split('-')[0].Split('.')
  $bp = $B.Split('-')[0].Split('.')
  for ($i = 0; $i -lt [Math]::Max($ap.Count, $bp.Count); $i++) {
    $av = if ($i -lt $ap.Count -and $ap[$i] -match '^\d+$') { [int]$ap[$i] } else { 0 }
    $bv = if ($i -lt $bp.Count -and $bp[$i] -match '^\d+$') { [int]$bp[$i] } else { 0 }
    if ($av -gt $bv) { return 1 }
    if ($av -lt $bv) { return -1 }
  }
  return 0
}

$InstalledVersion = ""
if (Test-Path $VersionFile) {
  $InstalledVersion = (Get-Content $VersionFile -ErrorAction SilentlyContinue | Select-Object -First 1)
}

if (-not $Version) {
  $Version = Resolve-Version -IncludePrerelease ([bool]$Prerelease)
}

$NeedInstall = $true
if ($InstalledVersion) {
  $cmp = Compare-Version -A (Strip-V $Version) -B (Strip-V $InstalledVersion)
  if ($cmp -le 0 -and -not $Force) { $NeedInstall = $false }
}

if ($DryRun) {
  Write-Host "[dry-run] target       = $Target"
  Write-Host "[dry-run] install-dir  = $InstallDir"
  Write-Host "[dry-run] repo-dir     = $RepoDir"
  Write-Host "[dry-run] bin-path     = $BinPath"
  Write-Host "[dry-run] version      = $Version (channel=$Channel)"
  Write-Host "[dry-run] installed    = $($InstalledVersion ? $InstalledVersion : 'none')"
  Write-Host "[dry-run] need-install = $NeedInstall"
  if (-not $NeedInstall) { Write-Host "(no download performed)"; exit 0 }
  Write-Host "[dry-run] would download: $GitHubDl/$Version/$AppName`_$Target.tar.gz"
  Write-Host "[dry-run] would verify : $GitHubDl/$Version/$AppName`_$Target.tar.gz.sha256"
  exit 0
}

if (-not $NeedInstall) {
  Write-Host "✔ classroom $InstalledVersion already installed at $BinPath"
  Write-Host "  Run '$AppBin --help' to verify, or re-run with -Force to reinstall."
  exit 0
}

# ---------- download ----------
$ArtifactName = "$AppName`_$Target.tar.gz"
$ChecksumName = "$ArtifactName.sha256"
$DownloadUrl  = "$GitHubDl/$Version/$ArtifactName"
$ChecksumUrl  = "$GitHubDl/$Version/$ChecksumName"

$TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("classroom-cli-installer-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null

try {
  $headers = @{ "User-Agent" = "$AppName-installer" }
  if ($env:GITHUB_TOKEN) { $headers["Authorization"] = "token $env:GITHUB_TOKEN" }

  $artifactPath = Join-Path $TmpDir $ArtifactName
  $checksumPath = Join-Path $TmpDir $ChecksumName

  Write-Host "→ Downloading $AppName $Version for $Target…"
  Invoke-WebRequest -Headers $headers -Uri $DownloadUrl -OutFile $artifactPath
  Invoke-WebRequest -Headers $headers -Uri $ChecksumUrl -OutFile $checksumPath

  # Verify SHA-256
  $expected = ((Get-Content $checksumPath | Select-Object -First 1) -split '\s+')[0].Trim().ToLower()
  $actual   = (Get-FileHash -Path $artifactPath -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) {
    throw "Checksum mismatch for $ArtifactName`n  expected: $expected`n  actual  : $actual"
  }
  Write-Host "✔ Checksum verified"

  # ---------- install ----------
  # Preserve credentials across installs.
  $preserveDir = $null
  $sessionsSrc = Join-Path $InstallDir "sessions"
  if (Test-Path $sessionsSrc) {
    $preserveDir = Join-Path $TmpDir "sessions-preserve"
    Copy-Item -Path $sessionsSrc -Destination $preserveDir -Recurse -Force
  }

  New-Item -ItemType Directory -Path $BinDir  -Force | Out-Null
  if (Test-Path $RepoDir) { Remove-Item -Path $RepoDir -Recurse -Force }
  New-Item -ItemType Directory -Path $RepoDir -Force | Out-Null

  # Extract tarball (PowerShell 7+ has built-in tar)
  tar -xzf $artifactPath -C $RepoDir

  if ($preserveDir) {
    $sessionsDst = Join-Path $InstallDir "sessions"
    if (Test-Path $sessionsDst) { Remove-Item -Path $sessionsDst -Recurse -Force }
    New-Item -ItemType Directory -Path $sessionsDst -Force | Out-Null
    Copy-Item -Path (Join-Path $preserveDir "*") -Destination $sessionsDst -Recurse -Force
  }

  Set-Content -Path $VersionFile -Value $Version -NoNewline

  # Create launcher. On Windows use a .cmd shim; on *nix use a symlink.
  if ($IsWindows) {
    $cmdShim = "$BinPath.cmd"
    $exeInRepo = Join-Path $RepoDir "dist/$AppBin.exe"
    @"
@echo off
"$exeInRepo" %*
"@ | Set-Content -Path $cmdShim -Encoding ASCII
  } else {
    $target = "../repo/dist/$AppBin$BinExt"
    if (Test-Path $BinPath) { Remove-Item -Path $BinPath -Force }
    New-Item -ItemType SymbolicLink -Path $BinPath -Target $target | Out-Null
  }

  Write-Host "✔ Installed $AppName $Version → $BinPath"

  # PATH nudge
  $pathHasBin = ($env:PATH -split [IO.Path]::PathSeparator) -contains $BinDir
  if (-not $pathHasBin) {
    Write-Host ""
    Write-Host "⚠ $BinDir is not on your PATH."
    Write-Host ""
    Write-Host "PowerShell (current session):"
    Write-Host "  `$env:PATH = '$BinDir;' + `$env:PATH"
    Write-Host ""
    Write-Host "Add to your profile to persist:"
    Write-Host "  Add-Content `$PROFILE `"`$env:PATH = '$BinDir;' + `$env:PATH`""
    Write-Host ""
    Write-Host "Or call the binary by absolute path:"
    Write-Host "  $BinPath --help"
  }
} finally {
  if (Test-Path $TmpDir) { Remove-Item -Path $TmpDir -Recurse -Force }
}