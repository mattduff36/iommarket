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

        if (args.Length > 1 || (args.Length == 1 && !LaunchRequest.TryParse(args[0], out _))) return 2;
        ApplicationConfiguration.Initialize();
        using var mutex = new Mutex(true, SingleInstanceMutexName, out var created);
        if (!created)
        {
            return WindowActivation.Signal(args.Length == 1 ? args[0] : "activate") ? 0 : 3;
        }
        using var form = new MainForm(args.Length == 1 ? args[0] : null);
        using var listener = new WindowActivation(form);
        Application.Run(form);
        mutex.ReleaseMutex();
        mutex.Dispose();
        if (form.PendingInstaller is string installer)
        {
            try { System.Diagnostics.Process.Start(UpdateInstaller.StartInfo(installer, AppContext.BaseDirectory)); }
            catch (System.ComponentModel.Win32Exception) { MessageBox.Show("Could not open the update installer. Your installed version is unchanged. Reopen Stock Update to try again.", "iTrader Stock Update"); }
        }
        return 0;
    }
}
