namespace StockUpdate;

internal static class Program
{
    public const string SingleInstanceMutexName = @"Local\iTrader.StockUpdate.SingleInstance";

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length >= 1 && args[0] == "--self-test")
        {
            var report = args.Length >= 2 ? args[1] : "";
            return DesktopTests.Run(report);
        }

        ApplicationConfiguration.Initialize();
        using var activation = new EventWaitHandle(false, EventResetMode.AutoReset, WindowActivation.EventName);
        using var mutex = new Mutex(true, SingleInstanceMutexName, out var created);
        if (!created)
        {
            WindowActivation.Signal(activation);
            return 0;
        }
        using var form = new MainForm();
        var listener = WindowActivation.Listen(activation, form);
        try { Application.Run(form); }
        finally { listener.Unregister(null); }
        mutex.ReleaseMutex();
        mutex.Dispose();
        if (form.PendingInstaller is string installer)
        {
            try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(installer) { UseShellExecute = true }); }
            catch (System.ComponentModel.Win32Exception) { MessageBox.Show("Could not open the update installer. Your installed version is unchanged. Reopen Stock Update to try again.", "iTrader Stock Update"); }
        }
        return 0;
    }
}
