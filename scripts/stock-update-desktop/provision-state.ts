import { spawn } from "node:child_process";

const PROTECT_SCRIPT = `
$ErrorActionPreference = 'Stop'
$raw = [Console]::In.ReadToEnd()
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String($raw.Trim())
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)
[Console]::Out.Write([Convert]::ToBase64String($protected))
`;

const UNPROTECT_SCRIPT = `
$ErrorActionPreference = 'Stop'
$raw = [Console]::In.ReadToEnd()
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String($raw.Trim())
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)
[Console]::Out.Write([Convert]::ToBase64String($plain))
`;

const ACL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Import-Module "$env:SystemRoot\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1" -Force
$path = [Console]::In.ReadToEnd().Trim()
$acl = Get-Acl -LiteralPath $path
$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRule($rule) }
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$access = [System.Security.AccessControl.FileSystemRights]::FullControl
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, $access, 'Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $path -AclObject $acl
`;

export const DPAPI_SCRIPTS = {
  protect: PROTECT_SCRIPT,
  unprotect: UNPROTECT_SCRIPT,
  acl: ACL_SCRIPT,
} as const;

function runPowerShell(script: string, stdin: string): Promise<string> {
  if (process.platform !== "win32") return Promise.reject(new Error("dpapi_unavailable"));
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    let failed = false;
    const deadline = setTimeout(() => { child.kill(); fail(); }, 20_000);
    deadline.unref();
    const fail = () => {
      if (failed) return;
      failed = true;
      clearTimeout(deadline);
      reject(new Error("dpapi_failed"));
    };
    child.stdout.on("data", (chunk: Buffer) => {
      out.push(chunk);
      if (Buffer.concat(out).length > 64_000) {
        child.kill();
        fail();
      }
    });
    child.stderr.on("data", () => undefined);
    child.on("error", fail);
    child.on("close", (code) => {
      clearTimeout(deadline);
      if (failed) return;
      if (code !== 0) fail();
      else resolve(Buffer.concat(out).toString("utf8").trim());
    });
    child.stdin.on("error", fail);
    child.stdin.end(stdin);
  });
}

export async function protectCurrentUser(plaintext: string): Promise<Buffer> {
  if (plaintext.length < 2 || plaintext.length > 16_000) throw new Error("dpapi_failed");
  const result = await runPowerShell(PROTECT_SCRIPT, Buffer.from(plaintext, "utf8").toString("base64"));
  if (!/^[A-Za-z0-9+/=]+$/.test(result)) throw new Error("dpapi_failed");
  return Buffer.from(result, "base64");
}

export async function unprotectCurrentUser(payload: Buffer): Promise<string> {
  const result = await runPowerShell(UNPROTECT_SCRIPT, payload.toString("base64"));
  if (!/^[A-Za-z0-9+/=]+$/.test(result)) throw new Error("dpapi_failed");
  return Buffer.from(result, "base64").toString("utf8");
}

export async function restrictToCurrentUser(filePath: string): Promise<void> {
  if (!filePath || /[\0\r\n]/.test(filePath)) throw new Error("acl_failed");
  await runPowerShell(ACL_SCRIPT, filePath);
}
