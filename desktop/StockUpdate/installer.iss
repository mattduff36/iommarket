; One offline installer. No credentials, network bootstrap, services or scheduled tasks.
#ifndef BuildRoot
  #error BuildRoot must name the verified private payload directory.
#endif
#ifndef AppVersion
  #define AppVersion "1.0.0"
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
DisableProgramGroupPage=yes
DisableDirPage=no
UsePreviousAppDir=yes
UninstallDisplayIcon={app}\StockUpdate.exe
SetupIconFile=..\..\app\favicon.ico
OutputDir={#BuildRoot}\release
OutputBaseFilename=iTrader Stock Update Setup-{#AppVersion}
Compression=lzma2/normal
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
; Signing is deliberately not faked. Release tooling signs separately when a real
; publisher certificate is available. This build remains an unsigned test build.

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
Source: "{#BuildRoot}\payload\x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: ".dependency-fingerprint,*.pdb"; Check: not IsArm64
Source: "{#BuildRoot}\payload\arm64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: ".dependency-fingerprint,*.pdb"; Check: IsArm64
Source: "{#BuildRoot}\browsers\*"; DestDir: "{app}\browsers"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#BuildRoot}\client-readme.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\iTrader\Stock Update"; Filename: "{app}\StockUpdate.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\iTrader Stock Update"; Filename: "{app}\StockUpdate.exe"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{autoprograms}\iTrader\Uninstall Stock Update"; Filename: "{uninstallexe}"

[UninstallDelete]
; App-owned encrypted sessions only. This is NOT server credential revocation.
Type: filesandordirs; Name: "{localappdata}\iTrader\StockUpdate"

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
  if WizardSilent then Exit;
  Result := MsgBox('This is an unsigned test build of iTrader Stock Update.' + #13#10 + #13#10 +
    'It includes both Preview and Production, but the selected website must have desktop access configured before sign-in works. Installation does not activate stock updates or run jobs.' + #13#10 + #13#10 +
    'Continue with installation?', mbConfirmation, MB_YESNO) = IDYES;
end;
