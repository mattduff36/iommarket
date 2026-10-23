using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;

namespace StockUpdate;

internal static class WindowActivation
{
    internal static string EventName => @"Local\iTrader.StockUpdate.Activate." + WindowsIdentity.GetCurrent().User?.Value;

    [DllImport("user32.dll")]
    private static extern bool AllowSetForegroundWindow(uint processId);

    internal static void Signal(EventWaitHandle signal)
    {
        // Grant foreground activation only to this user's existing executable.
        using var current = Process.GetCurrentProcess();
        foreach (var process in Process.GetProcessesByName(current.ProcessName))
        {
            using (process)
            {
                try
                {
                    if (process.Id != current.Id && process.SessionId == current.SessionId &&
                        string.Equals(process.MainModule?.FileName, Environment.ProcessPath, StringComparison.OrdinalIgnoreCase))
                        AllowSetForegroundWindow((uint)process.Id);
                }
                catch (System.ComponentModel.Win32Exception) { }
                catch (InvalidOperationException) { }
            }
        }
        signal.Set();
    }

    internal static RegisteredWaitHandle Listen(EventWaitHandle signal, Form form)
    {
        _ = form.Handle; // Create on the UI thread before registering the callback.
        return ThreadPool.RegisterWaitForSingleObject(signal, (_, _) =>
        {
            try
            {
                form.BeginInvoke(() =>
                {
                    if (form.IsDisposed) return;
                    form.Show();
                    if (form.WindowState == FormWindowState.Minimized) form.WindowState = FormWindowState.Normal;
                    form.BringToFront();
                    form.Activate();
                });
            }
            catch (InvalidOperationException) { /* Window has finished closing. */ }
        }, null, Timeout.Infinite, false);
    }
}
