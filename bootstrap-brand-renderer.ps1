<# 
bootstrap-brand-renderer.ps1
Quick bootstrap script to install missing dependencies for the iTrader brand renderer.

What it does:
- Checks for: winget, Git, Node.js, npm, pnpm
- Installs missing tools (prefers winget)
- Falls back to npm for pnpm if needed
- Pauses to ask questions when required

Run:
  PowerShell (Admin recommended):
    Set-ExecutionPolicy -Scope Process Bypass
    .\bootstrap-brand-renderer.ps1
#>

$ErrorActionPreference = "Stop"

function Write-Section($t) {
  Write-Host ""
  Write-Host "=== $t ===" -ForegroundColor Cyan
}

function Have-Command($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Pause-User($msg = "Press ENTER to continue") {
  Read-Host $msg | Out-Null
}

function Ask-YesNo($question, $defaultYes = $true) {
  $suffix = if ($defaultYes) { "[Y/n]" } else { "[y/N]" }
  while ($true) {
    $ans = Read-Host "$question $suffix"
    if ([string]::IsNullOrWhiteSpace($ans)) { return $defaultYes }
    switch ($ans.Trim().ToLower()) {
      "y" { return $true }
      "yes" { return $true }
      "n" { return $false }
      "no" { return $false }
      default { Write-Host "Please answer y or n." -ForegroundColor Yellow }
    }
  }
}

function Ensure-Winget() {
  Write-Section "Checking winget"
  if (Have-Command "winget") {
    Write-Host "winget: OK"
    return $true
  }

  Write-Host "winget not found." -ForegroundColor Yellow
  Write-Host "winget usually comes with App Installer (Microsoft Store)."
  Write-Host "Install/repair 'App Installer', then re-run this script."
  return $false
}

function Install-WithWinget($id, $displayName) {
  Write-Host "Installing $displayName via winget ($id)..."
  winget install --id $id --exact --silent --accept-source-agreements --accept-package-agreements | Out-Host
}

function Ensure-Git($useWinget) {
  Write-Section "Checking Git"
  if (Have-Command "git") {
    Write-Host "git: OK ($(& git --version))"
    return
  }

  Write-Host "git is missing." -ForegroundColor Yellow
  if ($useWinget -and (Ask-YesNo "Install Git now?" $true)) {
    Install-WithWinget "Git.Git" "Git"
  } else {
    Write-Host "Skipping Git install."
  }
}

function Ensure-Node($useWinget) {
  Write-Section "Checking Node.js"
  if (Have-Command "node" -and Have-Command "npm") {
    Write-Host "node: OK ($(& node -v))"
    Write-Host "npm : OK ($(& npm -v))"
    return
  }

  Write-Host "Node.js and/or npm is missing." -ForegroundColor Yellow
  if ($useWinget -and (Ask-YesNo "Install Node.js LTS now?" $true)) {
    Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js (LTS)"
    Write-Host "Re-checking node/npm..."
    if (!(Have-Command "node" -and Have-Command "npm")) {
      Write-Host "Node install may require a new terminal session." -ForegroundColor Yellow
      Write-Host "Close/reopen PowerShell, then re-run this script."
      Pause-User
      exit 1
    }
  } else {
    Write-Host "Skipping Node install."
  }
}

function Ensure-Pnpm() {
  Write-Section "Checking pnpm"
  if (Have-Command "pnpm") {
    Write-Host "pnpm: OK ($(& pnpm -v))"
    return
  }

  Write-Host "pnpm is missing." -ForegroundColor Yellow

  if (!(Have-Command "npm")) {
    Write-Host "npm is not available, so I can't install pnpm." -ForegroundColor Red
    Write-Host "Install Node.js first, then re-run."
    exit 1
  }

  if (Ask-YesNo "Install pnpm globally via npm (npm i -g pnpm)?" $true) {
    npm install -g pnpm | Out-Host

    if (!(Have-Command "pnpm")) {
      Write-Host "pnpm still not found. You may need to restart the terminal." -ForegroundColor Yellow
      Write-Host "Close/reopen PowerShell, then run: pnpm -v"
      Pause-User
      exit 1
    }

    Write-Host "pnpm installed: $(& pnpm -v)"
  } else {
    Write-Host "Skipping pnpm install."
  }
}

function Ensure-VCRedist($useWinget) {
  # Sharp usually works without this, but on some Windows installs it helps.
  Write-Section "Optional: Visual C++ Runtime (helps some native modules)"
  if (-not $useWinget) {
    Write-Host "winget not available; skipping VC++ runtime check/install."
    return
  }

  if (Ask-YesNo "Install/ensure Microsoft VC++ 2015-2022 Redistributable?" $false) {
    try {
      Install-WithWinget "Microsoft.VCRedist.2015+.x64" "VC++ 2015-2022 Redistributable (x64)"
    } catch {
      Write-Host "Could not install VC++ runtime via winget. Continuing anyway." -ForegroundColor Yellow
    }
  } else {
    Write-Host "Skipping VC++ runtime."
  }
}

# ---- Main ----
Write-Section "iTrader Brand Renderer - Dependency Bootstrap"

$useWinget = Ensure-Winget
if (-not $useWinget) {
  Write-Host ""
  Write-Host "Next step:" -ForegroundColor Yellow
  Write-Host "1) Install 'App Installer' from Microsoft Store (enables winget)"
  Write-Host "2) Re-run this script"
  Pause-User
  exit 1
}

Ensure-Git -useWinget $useWinget
Ensure-Node -useWinget $useWinget
Ensure-Pnpm
Ensure-VCRedist -useWinget $useWinget

Write-Section "Summary"
$gitStatus  = if (Have-Command "git")  { "OK" } else { "MISSING" }
$nodeStatus = if (Have-Command "node") { "OK" } else { "MISSING" }
$npmStatus  = if (Have-Command "npm")  { "OK" } else { "MISSING" }
$pnpmStatus = if (Have-Command "pnpm") { "OK" } else { "MISSING" }

Write-Host "git  : $gitStatus"
Write-Host "node : $nodeStatus"
Write-Host "npm  : $npmStatus"
Write-Host "pnpm : $pnpmStatus"

Write-Host ""
Write-Host "If everything shows OK, your next script can:" -ForegroundColor Green
Write-Host "  - create folders"
Write-Host "  - copy input files"
Write-Host "  - run: pnpm install; pnpm render"
Pause-User "Done. Press ENTER to exit."