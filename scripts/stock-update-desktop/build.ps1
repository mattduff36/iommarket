[CmdletBinding()]
param(
  [string]$ToolRoot = 'D:\Tools\itrader-stock-update-build',
  [string]$BuildRoot,
  [switch]$SkipRuntime,
  [switch]$SkipPublish
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (-not $BuildRoot) { $BuildRoot = Join-Path $repo 'private\stock-update-desktop-build' }
$BuildRoot = [IO.Path]::GetFullPath($BuildRoot)
$privateRoot = [IO.Path]::GetFullPath((Join-Path $repo 'private')) + [IO.Path]::DirectorySeparatorChar
if (-not $BuildRoot.StartsWith($privateRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Build output must be a dedicated directory below repository private.'
}
$dotnet = Join-Path $ToolRoot 'dotnet\dotnet.exe'
$iscc = Join-Path $ToolRoot 'inno\ISCC.exe'
$buildNode = Join-Path $ToolRoot 'downloads\node-v22.23.3-win-x64\node.exe'
$systemNode = (Get-Command node.exe -ErrorAction Stop).Source
foreach ($file in @($dotnet, $iscc)) { if (-not [IO.File]::Exists($file)) { throw "Missing private build tool: $file" } }
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
  # Child stderr is logged, not interpreted as a PowerShell terminating error.
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $Executable @Parameters > (Join-Path $BuildRoot "logs\$Label.log") 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $oldPreference
  if ($code -ne 0) { throw "$Label failed with exit code $code. See the corresponding build log." }
}

if (-not $SkipRuntime) {
  foreach ($architecture in @('x64','arm64')) {
    Invoke-Checked $systemNode @((Join-Path $PSScriptRoot 'package-runtime.mjs'), '--arch', $architecture, '--out', $BuildRoot, '--tools', $ToolRoot) "runtime-$architecture"
  }
}
foreach ($architecture in @('x64','arm64')) {
  $destination = Join-Path $BuildRoot "payload\$architecture"
  if (-not [IO.File]::Exists((Join-Path $destination 'runtime-manifest.json'))) { throw "Runtime for $architecture is missing." }
  if (-not $SkipPublish) {
    Invoke-Checked $dotnet @('publish', (Join-Path $repo 'desktop\StockUpdate\StockUpdate.csproj'), '-c', 'Release', '-r', "win-$architecture", '--self-contained', 'true', '-o', $destination, '--nologo') "publish-$architecture"
  }
  if (-not [IO.File]::Exists((Join-Path $destination 'StockUpdate.exe'))) { throw "Native application for $architecture is missing." }
}
$selfReport = Join-Path $BuildRoot 'desktop-self-test.json'
$testProcess = Start-Process -FilePath (Join-Path $BuildRoot 'payload\x64\StockUpdate.exe') -ArgumentList @('--self-test', ('"' + $selfReport + '"')) -Wait -PassThru
if ($testProcess.ExitCode -ne 0 -or -not [IO.File]::Exists($selfReport)) { throw 'Native offline self-test failed or did not produce a report.' }

@'
iTrader Stock Update - test build 1.0.1

This installer includes the application, its runtimes and browser. You do not need Git, Node.js, .NET, Cursor or repository access.

The application includes both Preview (itrader.dev) and Production (itrader.im). Choose the environment explicitly in the window. This internal test is Preview only. Production is not authorised.

1. Open iTrader Stock Update from the Start menu.
2. Leave Preview - itrader.dev selected. Do not select Production - itrader.im.
3. Click Sign in and use your existing administrator account in the browser. Approve this computer and Preview. The app does not ask for a password.
4. Click Check connection. This does not queue, approve or apply stock changes.
5. Click Open stock reviews only to view the website. Do not queue, approve or apply stock changes for this internal test.
6. Leave Start worker unused. If a job is already running, click Stop safely and let the current job finish before closing the application.
7. Use Sign out or Manage devices on the website if this computer should not keep access.

The computer must remain awake and connected while a worker is started. This tool does not run at Windows startup or schedule scrapes. Already queued eligible work in the explicitly selected environment can be processed while the worker is started. Do not start the worker for this internal test.

This is an unsigned test build. Do not disable Windows security. Contact Matt if Windows blocks installation. An unavailable sign-in is not fixed by reinstalling Node.js.

Use Sign out or the Manage devices website to revoke access before uninstalling. Uninstall removes this Windows user's local encrypted app sessions; it does not revoke server-side tokens or underlying database/image-service credentials. Report a lost computer to Matt so those credentials can be revoked or rotated.
'@ | Set-Content -Encoding UTF8 (Join-Path $BuildRoot 'client-readme.txt')
Invoke-Checked $iscc @("/Qp", ("/DBuildRoot=" + $BuildRoot), '/DAppVersion=1.0.1', (Join-Path $repo 'desktop\StockUpdate\installer.iss')) 'compile-installer'
$installer = Join-Path $BuildRoot 'release\iTrader Stock Update Setup-1.0.1.exe'
if (-not [IO.File]::Exists($installer)) { throw 'Compiler did not produce the expected installer.' }
$stream = [IO.File]::OpenRead($installer)
try { $digest = [Security.Cryptography.SHA256]::Create().ComputeHash($stream) }
finally { $stream.Dispose() }
$sha = ([BitConverter]::ToString($digest)).Replace('-','').ToLowerInvariant()
[IO.File]::WriteAllText(($installer + '.sha256'), ($sha + '  ' + [IO.Path]::GetFileName($installer) + "`r`n"))
Write-Host "Installer: $installer"
Write-Host "SHA256: $sha"
Write-Host 'Unsigned test build. ARM runtime execution, clean-machine acceptance and hosted stock-update checks are separate release gates.'
