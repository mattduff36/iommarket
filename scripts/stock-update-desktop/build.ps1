[CmdletBinding()]
param(
  [string]$ToolRoot = 'D:\Tools\itrader-stock-update-build',
  [string]$BuildRoot,
  [switch]$SkipRuntime
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$version = '1.1.3'
if (-not $BuildRoot) { $BuildRoot = Join-Path $repo "private\stock-update-release-$version" }
$BuildRoot = [IO.Path]::GetFullPath($BuildRoot)
$privateRoot = [IO.Path]::GetFullPath((Join-Path $repo 'private')) + [IO.Path]::DirectorySeparatorChar
if (-not $BuildRoot.StartsWith($privateRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Build output must be a dedicated directory below repository private.'
}
$dotnet = Join-Path $ToolRoot 'dotnet\dotnet.exe'
$iscc = Join-Path $ToolRoot 'inno\ISCC.exe'
$systemNode = (Get-Command node.exe -ErrorAction Stop).Source
foreach ($file in @($dotnet, $iscc)) { if (-not [IO.File]::Exists($file)) { throw "Missing private build tool: $file" } }

function Get-SourceCommit {
  $head = & git -C $repo rev-parse HEAD
  if ($LASTEXITCODE -ne 0) { throw 'Cannot read the source commit.' }
  $dirty = & git -C $repo status --porcelain
  if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'An installer requires a clean, committed checkout. Use the runtime exporter alone for development checks.' }
  return $head.Trim()
}
$sourceCommit = Get-SourceCommit
[IO.Directory]::CreateDirectory((Join-Path $BuildRoot 'logs')) | Out-Null
[IO.Directory]::CreateDirectory((Join-Path $BuildRoot 'release')) | Out-Null
[IO.Directory]::CreateDirectory((Join-Path $ToolRoot 'tmp')) | Out-Null
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:DOTNET_CLI_HOME = Join-Path $ToolRoot 'dotnet-home'
$env:NUGET_PACKAGES = Join-Path $ToolRoot 'nuget'
$env:TEMP = Join-Path $ToolRoot 'tmp'
$env:TMP = $env:TEMP

function Invoke-Checked([string]$Executable, [string[]]$Parameters, [string]$Label) {
  Write-Host $Label
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $Executable @Parameters > (Join-Path $BuildRoot "logs\$Label.log") 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $oldPreference
  if ($code -ne 0) { throw "$Label failed with exit code $code. See the corresponding build log." }
}
function Assert-NoPrivateFiles([string]$Directory) {
  foreach ($item in Get-ChildItem -LiteralPath $Directory -Force -Recurse) {
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        $item.Name -match '^(?:\.git|private|sessions|provisioning)$|^\.env(?:\.|$)|\.dpapi$|^(?:preview|production|session|sessions|credentials)\.(?:bin|json)$') {
      throw "Forbidden private file or link in release payload: $($item.Name)"
    }
  }
}
function Assert-Runtime([string]$Architecture) {
  $destination = Join-Path $BuildRoot "payload\$Architecture"
  $manifestPath = Join-Path $destination 'runtime-manifest.json'
  if (-not [IO.File]::Exists($manifestPath)) { throw "Runtime for $Architecture is missing." }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.version -ne $version -or $manifest.architecture -ne $Architecture -or
      $manifest.sourceHead -ne $sourceCommit -or $manifest.sourceDirty -ne $false -or
      $manifest.credentialsIncluded -ne $false) {
    throw "Runtime for $Architecture does not match the clean release commit."
  }
  $guard = "import {readFileSync} from 'node:fs'; import {resolve} from 'node:path'; import {verifyRuntimePayload} from './scripts/stock-update-desktop/runtime-boundary.mjs'; const p=process.argv[1]; const m=JSON.parse(readFileSync(resolve(p,'runtime-manifest.json'),'utf8')); verifyRuntimePayload(resolve(p,'worker'),m.sourceFiles);"
  Push-Location $repo
  try { Invoke-Checked $systemNode @('--input-type=module', '-e', $guard, $destination) "verify-runtime-$Architecture" }
  finally { Pop-Location }
  Assert-NoPrivateFiles $destination
}

if (-not $SkipRuntime) {
  foreach ($architecture in @('x64','arm64')) {
    Invoke-Checked $systemNode @((Join-Path $PSScriptRoot 'package-runtime.mjs'), '--arch', $architecture, '--out', $BuildRoot, '--tools', $ToolRoot) "runtime-$architecture"
  }
}
foreach ($architecture in @('x64','arm64')) {
  Assert-Runtime $architecture
  $destination = Join-Path $BuildRoot "payload\$architecture"
  # Always publish the native app from this commit; never reuse an earlier binary.
  Invoke-Checked $dotnet @('publish', (Join-Path $repo 'desktop\StockUpdate\StockUpdate.csproj'), '-c', 'Release', '-r', "win-$architecture", '--self-contained', 'true', '-o', $destination, '--nologo') "publish-$architecture"
  $native = Join-Path $destination 'StockUpdate.exe'
  if (-not [IO.File]::Exists($native) -or [Diagnostics.FileVersionInfo]::GetVersionInfo($native).FileVersion -ne "$version.0") { throw "Native application for $architecture has the wrong version." }
  Assert-Runtime $architecture
}
Assert-NoPrivateFiles (Join-Path $BuildRoot 'browsers')
$selfReport = Join-Path $BuildRoot 'desktop-self-test.json'
if ([IO.File]::Exists($selfReport)) { Remove-Item -LiteralPath $selfReport -Force }
$testProcess = Start-Process -FilePath (Join-Path $BuildRoot 'payload\x64\StockUpdate.exe') -ArgumentList @('--self-test', ('"' + $selfReport + '"')) -WindowStyle Hidden -Wait -PassThru
if ($testProcess.ExitCode -ne 0 -or -not [IO.File]::Exists($selfReport)) { throw 'Native offline self-test failed or did not produce a report.' }
if ((Get-SourceCommit) -ne $sourceCommit) { throw 'The source commit changed during the build.' }

Invoke-Checked $systemNode @((Join-Path $PSScriptRoot 'online-dependencies.mjs'), '--tools', $ToolRoot, '--out', $BuildRoot, '--worker', (Join-Path $BuildRoot 'payload\x64\worker')) 'online-dependencies'
@'
iTrader Stock Update - private internal release 1.1.3 (unsigned)

This installer includes the application and its reviewed worker packages. Setup downloads the matching official Node.js runtime and the pinned browser components, so an internet connection is required. A cancelled or failed download, checksum or extraction leaves any existing installation unchanged. You do not need Git, npm, .NET, Cursor or repository access. Setup downloads both Chromium modes needed by the configured dealer websites.

Use Preview - itrader.dev. Production needs separate approval and is not enabled by this release.

1. Open iTrader Stock Update from the Start menu and leave Preview selected.
2. Click Sign in. In your browser, use your administrator account and approve this computer for Preview. The app does not collect your password.
3. Keep the app open. Stock Reviews shows Connected when ready. The app never starts a job just by signing in.
4. Open Stock Reviews. Queue the intended dealer scan, then click Start worker on Stock Reviews. Leave the computer awake and connected.
5. Review the completed report on the website. Check all proposed changes and source photos. Approve only the report you intend to apply. Incomplete scans and missing photos must be resolved, not bypassed.
6. After approval, click Start worker again. The worker stops automatically when the queue is empty. The server stages the approved photos and applies the whole approved report together. Confirm the report outcome and listings in Stock Reviews.
7. Click Stop safely on Stock Reviews or in the app when finished. It finishes the current job, takes no next job and then stops. Wait for it before closing.

There is no scheduled scan, startup worker or automatic approval. Any already queued eligible work for the selected environment may be processed while the worker runs.

If a connection, authorisation or processing error appears, the worker stops. Check the actual job/report outcome in Stock Reviews before restarting or queuing anything again; a response can be lost after a server operation succeeds.

The app receives only a revocable session token. It never receives database credentials or ImageKit private keys. Windows encrypts the saved session for this Windows user. Sign out or use Manage devices to revoke this computer before handing it to someone else.

Upgrades replace the application, worker and runtime only after those downloads have been verified. Encrypted sessions are preserved. Uninstall removes this user's local app data; it does not revoke the server session. Use Manage devices to revoke access after loss or uninstall.

This is an unsigned application for the agreed private internal use. Signing is out of scope. Do not disable Windows security. Contact Matt if Windows blocks installation.
'@ | Set-Content -Encoding UTF8 (Join-Path $BuildRoot 'client-readme.txt')
Invoke-Checked $iscc @('/Qp', ("/DBuildRoot=" + $BuildRoot), ("/DAppVersion=" + $version), (Join-Path $repo 'desktop\StockUpdate\installer.iss')) 'compile-installer'
$installer = Join-Path $BuildRoot "release\iTrader Stock Update Setup-$version.exe"
if (-not [IO.File]::Exists($installer)) { throw 'Compiler did not produce the expected installer.' }
if ((Get-SourceCommit) -ne $sourceCommit) { throw 'The source commit changed during installer compilation.' }
$stream = [IO.File]::OpenRead($installer)
try { $digest = [Security.Cryptography.SHA256]::Create().ComputeHash($stream) }
finally { $stream.Dispose() }
$sha = ([BitConverter]::ToString($digest)).Replace('-','').ToLowerInvariant()
[IO.File]::WriteAllText(($installer + '.sha256'), ($sha + '  ' + [IO.Path]::GetFileName($installer) + [Environment]::NewLine))
$release = [ordered]@{
  version = $version; sourceCommit = $sourceCommit; unsigned = $true
  installer = [IO.Path]::GetFileName($installer); installerSha256 = $sha
  installerBytes = (Get-Item -LiteralPath $installer).Length
  architectures = @('x64','arm64'); armHardwareVerified = $false
  builtAt = [DateTime]::UtcNow.ToString('o')
}
$release | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $BuildRoot 'release\release-manifest.json')
Write-Host "Installer: $installer"
Write-Host "SHA256: $sha"
Write-Host "Source commit: $sourceCommit"
Write-Host 'Unsigned internal release. Hosted workflow and physical device acceptance are separate gates.'
