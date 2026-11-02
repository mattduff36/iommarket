; Unsigned private installer. The app and worker are bundled. Setup downloads only pinned Node and browser archives.
#ifndef BuildRoot
  #error BuildRoot must name the verified private payload directory.
#endif
#ifndef AppVersion
  #define AppVersion "1.1.12"
#endif
#ifndef OnlineInclude
  #define OnlineInclude AddBackslash(BuildRoot) + "online-dependencies.iss"
#endif
#include OnlineInclude
#ifndef OnlineHeadlessSha
  #error Regenerate online-dependencies.iss before compiling the installer.
#endif
#ifdef SetupOutputDir
#else
  #define SetupOutputDir AddBackslash(BuildRoot) + "release"
#endif
#ifdef SetupBaseName
#else
  #define SetupBaseName "iTrader Stock Update Setup-" + AppVersion
#endif
#define ProductName "iTrader Stock Update"

[Setup]
AppId={{609BE835-6123-4C60-991E-0C33BB3811C8}
AppName={#ProductName}
AppVersion={#AppVersion}
AppPublisher=MPDEE
AppPublisherURL=https://www.mpdee.co.uk/
DefaultDirName={localappdata}\Programs\iTrader Stock Update
DefaultGroupName=iTrader
PrivilegesRequired=lowest
MinVersion=10.0.22000
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
AppMutex=Local\iTrader.StockUpdate.SingleInstance
CloseApplications=no
RestartApplications=no
ChangesAssociations=yes
DisableProgramGroupPage=yes
DisableDirPage=no
UsePreviousAppDir=yes
UsePreviousTasks=yes
UsePreviousGroup=yes
UninstallDisplayIcon={app}\StockUpdate.exe
SetupIconFile=..\..\app\favicon.ico
OutputDir={#SetupOutputDir}
OutputBaseFilename={#SetupBaseName}
Compression=lzma2/normal
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
ArchiveExtraction=full
; Unsigned private internal release. Signing is explicitly outside this release scope.

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked

[InstallDelete]
; Reached only after PrepareToInstall has downloaded, verified and extracted. Sessions live elsewhere.
Type: filesandordirs; Name: "{app}\worker"
Type: filesandordirs; Name: "{app}\runtime"
Type: filesandordirs; Name: "{app}\browsers"

[Files]
Source: "{#BuildRoot}\UpgradeBridge.exe"; Flags: dontcopy
Source: "{#BuildRoot}\payload\x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: ".dependency-fingerprint,*.pdb,runtime\*"; Check: not IsArm64
Source: "{#BuildRoot}\payload\arm64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: ".dependency-fingerprint,*.pdb,runtime\*"; Check: IsArm64
Source: "{tmp}\online-runtime\node.exe"; DestDir: "{app}\runtime"; Flags: external ignoreversion
Source: "{tmp}\online-runtime\LICENSE.node.txt"; DestDir: "{app}\runtime"; Flags: external ignoreversion
Source: "{tmp}\online-browsers\*"; DestDir: "{app}\browsers"; Flags: external ignoreversion recursesubdirs createallsubdirs
Source: "{#BuildRoot}\client-readme.txt"; DestDir: "{app}"; Flags: ignoreversion

[Registry]
Root: HKCU; Subkey: "Software\Classes\itrader-stock-update"; ValueType: string; ValueName: ""; ValueData: "URL:iTrader Stock Update"
Root: HKCU; Subkey: "Software\Classes\itrader-stock-update"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\itrader-stock-update\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\StockUpdate.exe"" ""%1"""

[Icons]
Name: "{autoprograms}\iTrader\Stock Update"; Filename: "{app}\StockUpdate.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\iTrader Stock Update"; Filename: "{app}\StockUpdate.exe"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{autoprograms}\iTrader\Uninstall Stock Update"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\StockUpdate.exe"; WorkingDir: "{app}"; Description: "Open iTrader Stock Update"; Flags: nowait postinstall skipifsilent

Filename: "{app}\StockUpdate.exe"; WorkingDir: "{app}"; Flags: nowait; Check: IsAppUpdate

[UninstallDelete]
; App-owned encrypted sessions only. This is NOT server credential revocation.
Type: filesandordirs; Name: "{localappdata}\iTrader\StockUpdate"

[Code]
var
  DownloadPage: TDownloadWizardPage;

function GetCurrentProcessId: LongWord; external 'GetCurrentProcessId@kernel32.dll stdcall';

function IsAppUpdate: Boolean;
begin
  Result := ExpandConstant('{param:UPDATEAPP|0}') = '1';
end;

procedure InitializeWizard;
begin
  DownloadPage := CreateDownloadPage('Downloading Stock Update components',
    'Downloading the pinned Node.js runtime and browser components. The existing installation stays in place until the downloads are verified.',
    nil);
end;

function StageExtractedDirectory(const Archive, Directory, RelativeExe: String): String;
var
  Dest, Exe: String;
begin
  Dest := ExpandConstant('{tmp}\online-browsers\' + Directory);
  ForceDirectories(Dest);
  ExtractArchive(Archive, Dest, '', True, nil);
  Exe := Dest + '\' + RelativeExe;
  if not FileExists(Exe) then begin
    Result := 'Required file missing after extraction: ' + RelativeExe + '. The existing installation was not changed.';
    Exit;
  end;
  if not SaveStringToFile(Dest + '\INSTALLATION_COMPLETE', '', False) then
    Result := 'Could not write INSTALLATION_COMPLETE. The existing installation was not changed.'
  else
    Result := '';
end;

function DownloadAndStageDependencies: String;
var
  NodeUrl, NodeSha, NodeFolder, NodeRoot, RuntimeDir: String;
begin
  Result := '';
  if DownloadPage = nil then begin
    Result := 'Download page was not created. The existing installation was not changed.';
    Exit;
  end;
  if IsArm64 then begin
    NodeUrl := '{#OnlineNodeArm64Url}';
    NodeSha := '{#OnlineNodeArm64Sha}';
    NodeFolder := '{#OnlineNodeFolderArm64}';
  end else if IsX64Compatible then begin
    NodeUrl := '{#OnlineNodeX64Url}';
    NodeSha := '{#OnlineNodeX64Sha}';
    NodeFolder := '{#OnlineNodeFolderX64}';
  end else begin
    Result := 'A 64-bit version of Windows is required. The existing installation was not changed.';
    Exit;
  end;
  DownloadPage.Clear;
  DownloadPage.Add(NodeUrl, 'node.zip', NodeSha);
  DownloadPage.Add('{#OnlineChromiumUrl}', 'chromium.zip', '{#OnlineChromiumSha}');
  DownloadPage.Add('{#OnlineHeadlessUrl}', 'headless.zip', '{#OnlineHeadlessSha}');
  DownloadPage.Add('{#OnlineFfmpegUrl}', 'ffmpeg.zip', '{#OnlineFfmpegSha}');
  DownloadPage.Add('{#OnlineWinlddUrl}', 'winldd.zip', '{#OnlineWinlddSha}');
  if not WizardSilent then DownloadPage.Show;
  try
    try
      DownloadPage.Download;
      NodeRoot := ExpandConstant('{tmp}\online-node-extract');
      RuntimeDir := ExpandConstant('{tmp}\online-runtime');
      ForceDirectories(NodeRoot);
      ForceDirectories(RuntimeDir);
      ExtractArchive(ExpandConstant('{tmp}\node.zip'), NodeRoot, '', True, nil);
      if not FileExists(NodeRoot + '\' + NodeFolder + '\node.exe') then begin
        Result := 'node.exe was not in the verified archive. The existing installation was not changed.';
        Exit;
      end;
      if not FileCopy(NodeRoot + '\' + NodeFolder + '\node.exe', RuntimeDir + '\node.exe', False) then begin
        Result := 'Could not stage node.exe. The existing installation was not changed.';
        Exit;
      end;
      if not FileCopy(NodeRoot + '\' + NodeFolder + '\LICENSE', RuntimeDir + '\LICENSE.node.txt', False) then begin
        Result := 'Could not stage the Node licence. The existing installation was not changed.';
        Exit;
      end;
      Result := StageExtractedDirectory(ExpandConstant('{tmp}\chromium.zip'), '{#OnlineChromiumDir}', '{#OnlineChromiumExe}');
      if Result <> '' then Exit;
      Result := StageExtractedDirectory(ExpandConstant('{tmp}\headless.zip'), '{#OnlineHeadlessDir}', '{#OnlineHeadlessExe}');
      if Result <> '' then Exit;
      Result := StageExtractedDirectory(ExpandConstant('{tmp}\ffmpeg.zip'), '{#OnlineFfmpegDir}', '{#OnlineFfmpegExe}');
      if Result <> '' then Exit;
      Result := StageExtractedDirectory(ExpandConstant('{tmp}\winldd.zip'), '{#OnlineWinlddDir}', '{#OnlineWinlddExe}');
    except
      if DownloadPage.AbortedByUser then
        Result := 'Download cancelled. The existing installation was not changed.'
      else
        Result := GetExceptionMessage + ' The existing installation was not changed.';
    end;
  finally
    if not WizardSilent then DownloadPage.Hide;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  // Interactive and silent setup both call this before [InstallDelete].
  NeedsRestart := False;
  Result := DownloadAndStageDependencies;
end;

function InitializeSetup(): Boolean;
var
  ExistingDir: String;
  ExitCode: Integer;
begin
  Result := True;
  if WizardSilent then Exit;
  // Older clients launch setup without arguments. Upgrade their registered
  // installation unattended too; fresh installs retain the normal wizard.
  if RegQueryStringValue(HKCU64,
      'Software\Microsoft\Windows\CurrentVersion\Uninstall\{609BE835-6123-4C60-991E-0C33BB3811C8}_is1',
      'Inno Setup: App Path', ExistingDir) and
      (Pos('"', ExistingDir) = 0) and FileExists(ExistingDir + '\StockUpdate.exe') then begin
    ExtractTemporaryFile('UpgradeBridge.exe');
    if not Exec(ExpandConstant('{tmp}\UpgradeBridge.exe'),
        '"' + ExpandConstant('{srcexe}') + '" ' + IntToStr(GetCurrentProcessId),
        '', SW_HIDE, ewNoWait, ExitCode) then
      MsgBox('Could not start the update. The existing app is unchanged. ' + SysErrorMessage(ExitCode), mbError, MB_OK);
    Result := False;
    Exit;
  end;
  Result := MsgBox('This is an unsigned private internal release of iTrader Stock Update.' + #13#10 + #13#10 +
    'Setup needs an internet connection to download the pinned Node.js runtime and browser components. If that download is cancelled or fails verification, any existing installation is left unchanged.' + #13#10 + #13#10 +
    'It includes both Preview and Production. Choose the environment explicitly in the app. Production access is restricted to authorised administrators. The selected website must have desktop access configured before sign-in works. Installation does not activate stock updates or run jobs.' + #13#10 + #13#10 +
    'Continue with installation?', mbConfirmation, MB_YESNO) = IDYES;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Command: String;
begin
  if (CurUninstallStep = usUninstall) and
    RegQueryStringValue(HKCU, 'Software\Classes\itrader-stock-update\shell\open\command', '', Command) and
    (CompareText(Command, ExpandConstant('"{app}\StockUpdate.exe" "%1"')) = 0) then
    RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Classes\itrader-stock-update');
end;
