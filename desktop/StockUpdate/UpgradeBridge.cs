// Compiled separately for the Windows-included .NET Framework; never enters the app.
using System;
using System.Diagnostics;
using System.IO;
using Microsoft.Win32;
internal static class UpgradeBridge
{
    private static string Quote(string value)
    {
        if (value.IndexOf('"') >= 0 || value.IndexOf('\r') >= 0 || value.IndexOf('\n') >= 0)
            throw new ArgumentException("Invalid path");
        return "\"" + value.TrimEnd('\\') + "\"";
    }
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            int parent;
            if (args.Length != 2 || !int.TryParse(args[1], out parent)) return 1;
            string installer = Path.GetFullPath(args[0]);
            if (!File.Exists(installer) || !installer.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) return 1;
            using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\{609BE835-6123-4C60-991E-0C33BB3811C8}_is1"))
            {
                string directory = key == null ? null : key.GetValue("Inno Setup: App Path") as string;
                if (string.IsNullOrWhiteSpace(directory) || !File.Exists(Path.Combine(directory, "StockUpdate.exe"))) return 1;
                try { using (var process = Process.GetProcessById(parent)) { if (!process.WaitForExit(30000)) return 1; } }
                catch (ArgumentException) { /* Setup already exited. */ }
                Process.Start(new ProcessStartInfo(installer,
                    "/SP- /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /NOCLOSEAPPLICATIONS /UPDATEAPP=1 /DIR=" + Quote(directory))
                    { UseShellExecute = true });
            }
            return 0;
        }
        catch (Exception ex)
        {
            try { File.WriteAllText(Path.Combine(Path.GetTempPath(), "iTrader-update-launch-error.txt"), ex.GetType().Name + ": " + ex.Message); } catch { }
            return 1;
        }
    }
}
