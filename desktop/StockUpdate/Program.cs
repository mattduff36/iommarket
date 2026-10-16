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
        using var mutex = new Mutex(true, SingleInstanceMutexName, out var created);
        if (!created)
        {
            MessageBox.Show("iTrader Stock Update is already running.", "iTrader Stock Update");
            return 1;
        }
        Application.Run(new MainForm());
        GC.KeepAlive(mutex);
        return 0;
    }
}
