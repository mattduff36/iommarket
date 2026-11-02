using System.Text.Json;
using System.Text.RegularExpressions;

namespace StockUpdate;

public sealed record LaunchRequest(AppEnvironment Environment, string Ticket)
{
    // Windows ShellExecute inserts an empty path slash after the authority.
    // Accept only that equivalent form; never accept aliases or percent escapes.
    public static bool TryParse(string? value, out LaunchRequest request)
    {
        request = null!;
        if (value is null || value.Length > 180) return false;
        var match = Regex.Match(value, @"\Aitrader-stock-update://launch/?\?environment=(preview|production)&ticket=([A-Za-z0-9_-]{43})\z", RegexOptions.CultureInvariant);
        if (!match.Success || !Targets.TryParse(match.Groups[1].Value, out var environment)) return false;
        request = new LaunchRequest(environment, match.Groups[2].Value);
        return true;
    }
    public override string ToString() => "Stock Update launch (ticket redacted)";
}

public sealed record LaunchReply(WorkerSession Session, Guid LaunchId, string Mode, string[] JobIds, bool CloseAfterRun)
{
    public static bool ValidJobIds(IReadOnlyList<string> ids) => ids.Count is > 0 and <= 100 &&
        ids.Distinct(StringComparer.Ordinal).Count() == ids.Count &&
        ids.All(id => Regex.IsMatch(id, @"\Ac[a-z0-9]{24,32}\z", RegexOptions.CultureInvariant));

    public static bool TryParse(string json, AppEnvironment environment, out LaunchReply reply)
    {
        reply = null!;
        try
        {
            using var doc = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 8 });
            var root = doc.RootElement;
            if (!SessionParser.ExactFields(root, "session", "launchId", "mode", "jobIds", "closeAfterRun") ||
                !SessionParser.TryParse(root.GetProperty("session").GetRawText(), environment, out var session)) return false;
            var id = root.GetProperty("launchId").GetString();
            var mode = root.GetProperty("mode").GetString();
            var close = root.GetProperty("closeAfterRun").GetBoolean();
            var jobs = root.GetProperty("jobIds").EnumerateArray().Select(x => x.GetString() ?? "").ToArray();
            if (!WorkerControlClient.Uuid(id) || mode is not ("open" or "task") ||
                (mode == "task" ? !close || !ValidJobIds(jobs) : close || jobs.Length != 0)) return false;
            reply = new LaunchReply(session, Guid.Parse(id!), mode, jobs, close);
            return true;
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or KeyNotFoundException or FormatException) { return false; }
    }
}
