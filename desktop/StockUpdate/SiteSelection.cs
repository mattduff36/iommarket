namespace StockUpdate;

// Production is deliberately never persisted: every process starts in Preview.
public sealed class SiteSelection
{
    public AppEnvironment Environment { get; private set; } = AppEnvironment.Preview;
    public bool TrySwitch(bool busy, bool running, Func<bool> confirmProduction)
    {
        if (busy || running) return false;
        if (Environment == AppEnvironment.Preview && !confirmProduction()) return false;
        Environment = Environment == AppEnvironment.Preview ? AppEnvironment.Production : AppEnvironment.Preview;
        return true;
    }
}
