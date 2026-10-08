<#
  Mana - prerequisite checker (Windows)
  Usage:
    powershell -ExecutionPolicy Bypass -File .\check-prereqs.ps1
    powershell -ExecutionPolicy Bypass -File .\check-prereqs.ps1 -ModelsPath "D:\AI\models"
  This script only READS your system. It installs and changes nothing.
#>

param(
    [string]$ModelsPath = ""
)

$script:missing = @()
$script:warned  = @()

function Ok($name, $detail)   { Write-Host ("  [OK]   {0,-22} {1}" -f $name, $detail) -ForegroundColor Green }
function Warn($name, $detail) { Write-Host ("  [WARN] {0,-22} {1}" -f $name, $detail) -ForegroundColor Yellow; $script:warned += $name }
function Fail($name, $detail) { Write-Host ("  [MISS] {0,-22} {1}" -f $name, $detail) -ForegroundColor Red; $script:missing += $name }
function Section($t)          { Write-Host ""; Write-Host "== $t ==" -ForegroundColor Cyan }

function Get-CmdVersion($cmd, $versionArg) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { return $null }
    try { return (& $cmd $versionArg 2>&1 | Select-Object -First 1).ToString().Trim() } catch { return $null }
}

Write-Host "Mana prerequisite check" -ForegroundColor Cyan
Write-Host "Windows: $([System.Environment]::OSVersion.VersionString)"

# ---------------------------------------------------------------- Tooling
Section "Core tools"

# Node.js (want 18+, LTS 20/22 recommended)
$nodeV = Get-CmdVersion "node" "--version"
if ($nodeV -and $nodeV -match 'v?(\d+)\.\d+') {
    $major = [int]$Matches[1]
    if ($major -ge 20) { Ok "Node.js" $nodeV }
    elseif ($major -ge 18) { Warn "Node.js" "$nodeV (works, but LTS 20+ is better)" }
    else { Fail "Node.js" "$nodeV is too old, install the current LTS from nodejs.org" }
} else { Fail "Node.js" "not found. Install the LTS from https://nodejs.org" }

# npm
$npmV = Get-CmdVersion "npm" "--version"
if ($npmV) { Ok "npm" $npmV } else { Fail "npm" "not found (comes with Node.js)" }

# Git
$gitV = Get-CmdVersion "git" "--version"
if ($gitV) { Ok "Git" $gitV } else { Fail "Git" "not found. Install from https://git-scm.com" }

# ---------------------------------------------------------------- Rust
Section "Rust"

$rustcV = Get-CmdVersion "rustc" "--version"
if ($rustcV) { Ok "rustc" $rustcV } else { Fail "rustc" "not found. Install via https://rustup.rs" }

$cargoV = Get-CmdVersion "cargo" "--version"
if ($cargoV) { Ok "cargo" $cargoV } else { Fail "cargo" "not found (comes with rustup)" }

if (Get-Command rustup -ErrorAction SilentlyContinue) {
    $toolchain = (rustup show active-toolchain 2>&1 | Select-Object -First 1).ToString()
    if ($toolchain -match "msvc") { Ok "Rust toolchain" $toolchain }
    else { Warn "Rust toolchain" "$toolchain  (Tauri on Windows needs the *-msvc toolchain)" }
} else {
    Fail "rustup" "not found. Install via https://rustup.rs"
}

# ---------------------------------------------------------------- Build tools
Section "Windows build tools (needed by Tauri)"

$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
    $vsPath = & $vswhere -products * -latest `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath 2>$null
    if ($vsPath) { Ok "MSVC C++ tools" $vsPath }
    else { Fail "MSVC C++ tools" "VS found, but 'Desktop development with C++' workload is missing" }
} else {
    Fail "MSVC C++ tools" "Visual Studio Build Tools not found. Install 'Desktop development with C++'"
}

# Windows SDK
$sdkRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\Include"
if (Test-Path $sdkRoot) {
    $sdk = (Get-ChildItem $sdkRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1).Name
    Ok "Windows 10/11 SDK" $sdk
} else {
    Fail "Windows 10/11 SDK" "not found (include it in the Build Tools installer)"
}

# WebView2 runtime
$wv2Keys = @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
)
$wv2 = $null
foreach ($k in $wv2Keys) {
    if (Test-Path $k) { $wv2 = (Get-ItemProperty $k -ErrorAction SilentlyContinue).pv; if ($wv2) { break } }
}
if ($wv2) { Ok "WebView2 runtime" $wv2 }
else { Fail "WebView2 runtime" "not found. Get the Evergreen runtime from Microsoft (Win 11 usually has it)" }

# ---------------------------------------------------------------- GPU
Section "GPU / CUDA (for llama.cpp)"

if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
    $gpu = (nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader 2>$null | Select-Object -First 1)
    if ($gpu) {
        $parts = $gpu -split ',\s*'
        Ok "NVIDIA GPU" $parts[0]
        Ok "VRAM" $parts[2]
        $drv = [double]($parts[1] -replace '^(\d+\.\d+).*','$1')
        # CUDA 12.8 (needed for RTX 50-series) wants driver 570+
        if ($drv -ge 570) { Ok "Driver" "$($parts[1]) (new enough for CUDA 12.8)" }
        else { Warn "Driver" "$($parts[1]) - RTX 50-series needs 570+ for CUDA 12.8. Update from nvidia.com" }
    } else { Warn "NVIDIA GPU" "nvidia-smi ran but returned nothing" }
} else {
    Fail "NVIDIA driver" "nvidia-smi not found. Install the latest NVIDIA driver"
}

# CUDA toolkit is optional: prebuilt llama.cpp CUDA releases bundle their runtime DLLs
$nvcc = Get-CmdVersion "nvcc" "--version"
if ($nvcc) { Ok "CUDA toolkit (opt.)" "installed" }
else { Ok "CUDA toolkit (opt.)" "not installed - fine, prebuilt llama.cpp doesn't need it" }

# ---------------------------------------------------------------- llama.cpp
Section "llama.cpp"

$llama = Get-Command "llama-server" -ErrorAction SilentlyContinue
if ($llama) {
    Ok "llama-server" $llama.Source
} else {
    $found = $null
    foreach ($root in @("$env:USERPROFILE\Downloads", "$env:USERPROFILE\Desktop", "$env:USERPROFILE\Documents", "C:\llama.cpp", "C:\ai")) {
        if (Test-Path $root) {
            $hit = Get-ChildItem $root -Recurse -Filter "llama-server.exe" -Depth 3 -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($hit) { $found = $hit.FullName; break }
        }
    }
    if ($found) { Ok "llama-server.exe" $found }
    else { Fail "llama-server.exe" "not found. Download a CUDA 12.x Windows release from github.com/ggml-org/llama.cpp/releases" }
}

# ---------------------------------------------------------------- GGUF models
Section "GGUF models"

$searchRoots = @("$env:USERPROFILE\Downloads", "$env:USERPROFILE\Documents", "$env:USERPROFILE\Desktop", "$env:USERPROFILE\.cache\lm-studio", "$env:USERPROFILE\.ollama")
if ($ModelsPath -and (Test-Path $ModelsPath)) { $searchRoots = @($ModelsPath) + $searchRoots }

$ggufs = @()
foreach ($root in $searchRoots) {
    if (Test-Path $root) {
        $ggufs += Get-ChildItem $root -Recurse -Filter "*.gguf" -ErrorAction SilentlyContinue
    }
}
$ggufs = $ggufs | Sort-Object FullName -Unique

if ($ggufs.Count -gt 0) {
    Ok "GGUF files found" "$($ggufs.Count)"
    foreach ($g in ($ggufs | Sort-Object Length -Descending)) {
        $gb = [math]::Round($g.Length / 1GB, 2)
        $tag = if ($g.Name -match "mmproj") { "  (vision projector)" } else { "" }
        Write-Host ("         {0,6} GB   {1}{2}" -f $gb, $g.Name, $tag)
    }
    Write-Host "         (Send me this list and I'll tell you which fits your VRAM.)" -ForegroundColor DarkGray
} else {
    Warn "GGUF files" "none found in common folders. Re-run with -ModelsPath ""D:\your\folder"""
}

# ---------------------------------------------------------------- Summary
Section "Summary"

if ($script:missing.Count -eq 0 -and $script:warned.Count -eq 0) {
    Write-Host "  Everything looks ready. We can start step 1!" -ForegroundColor Green
} else {
    if ($script:missing.Count -gt 0) {
        Write-Host "  Missing: $($script:missing -join ', ')" -ForegroundColor Red
    }
    if ($script:warned.Count -gt 0) {
        Write-Host "  Warnings: $($script:warned -join ', ')" -ForegroundColor Yellow
    }
    Write-Host "  Install what's missing, then re-run this script. You can also paste the output to me."
}
Write-Host ""
