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
        GC.KeepAlive(mutex);
        return 0;
    }
}
