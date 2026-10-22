using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace StockUpdate;

public sealed record WorkerLaunchPlan(
    string NodePath,
    string WorkingDirectory,
    IReadOnlyList<string> Arguments,
    IReadOnlyDictionary<string, string> Environment,
    string StdinJson);

public readonly record struct OutputEvent(string Display, bool UnverifiedFinish, string Code = "");

public static class WorkerProcess
{
    public const string UnverifiedFinishMessage =
        "The worker reported finished processing. Check the result in the iTrader admin page. This is not a verified success.";

    private static readonly string[] AllowedParent =
    [
        "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
        "COMSPEC", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "OS",
        "USERNAME", "USERDOMAIN", "SYSTEMDRIVE"
    ];

    public static bool CanStartWorker(bool closing, bool disposed, bool cancelled, bool authorised) =>
        !closing && !disposed && !cancelled && authorised;

    public static bool TryCreatePlan(
        string appRoot,
        AppEnvironment environment,
        string accessToken,
        string mode,
        IReadOnlyDictionary<string, string> parentEnvironment,
        out WorkerLaunchPlan plan,
        out string error)
    {
        plan = null!;
        error = "missing_payload";
        if (!Enum.IsDefined(environment)) { error = "invalid_request"; return false; }
        if (mode is not ("check" or "watch")) { error = "invalid_request"; return false; }
        if (!TokenShapes.Base64Url(accessToken, 43)) { error = "not_signed_in"; return false; }
        var root = Path.GetFullPath(appRoot);
        var node = Path.Combine(root, "runtime", "node.exe");
        var worker = Path.Combine(root, "worker");
        var script = Path.Combine(worker, "scripts", "dealer-stock-sync", "desktop-worker.ts");
        var browsers = Path.Combine(root, "browsers");
        if (!File.Exists(node) || !Directory.Exists(worker) || !Directory.Exists(Path.Combine(worker, "node_modules"))
            || !File.Exists(Path.Combine(worker, "tsconfig.json")) || !File.Exists(script) || !Directory.Exists(browsers))
            return false;
        var env = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var key in AllowedParent)
        {
            if (parentEnvironment.TryGetValue(key, out var value) && value.Length > 0 && value.Length < 32768)
                env[key] = value;
        }
        if (!env.ContainsKey("SYSTEMROOT")) return false;
        env["PATH"] = string.Join(";", Path.GetDirectoryName(node), Path.Combine(env["SYSTEMROOT"], "System32"), env["SYSTEMROOT"]);
        env["NODE_ENV"] = "production";
        env["PLAYWRIGHT_BROWSERS_PATH"] = browsers;
        var stdin = JsonSerializer.Serialize(new
        {
            environment = Targets.WireName(environment),
            accessToken
        });
        plan = new WorkerLaunchPlan(
            node,
            worker,
            ["--import", "tsx", "scripts/dealer-stock-sync/desktop-worker.ts", "--mode", mode],
            env,
            stdin);
        error = "";
        return true;
    }

    public static bool TryInterpret(string line, out OutputEvent output)
    {
        output = default;
        if (line.Length == 0 || line.Length > 4000 || line[0] != '{') return false;
        try
        {
            using var doc = JsonDocument.Parse(line, new JsonDocumentOptions { MaxDepth = 6 });
            var root = doc.RootElement;
            var type = Str(root, "type");
            var state = Str(root, "state");
            var message = Str(root, "message");
            if (type is not ("status" or "job" or "error" or "check")) return false;
            if (state is null || state.Length is 0 or > 40) return false;
            if (message is null || message.Length > 300) return false;
            if (state == "processing-finished" || message.Contains("finished processing", StringComparison.OrdinalIgnoreCase))
            {
                output = new OutputEvent(UnverifiedFinishMessage, true, "processing-finished");
                return true;
            }
            // Never echo arbitrary child JSON messages into diagnostics. Only
            // recognised states have fixed, non-secret display text.
            var safe = state switch {
                "checking" => "Checking authorisation and the installed runtime.",
                "passed" => "Read-only checks passed. No jobs or photo uploads were run.",
                "ready" => "Manual worker ready. Already queued jobs may be processed.",
                "waiting" => "Waiting for queued work. Weekly scheduling is off.",
                "processing" => "Processing a queued stock job.",
                "staging-photos" when type == "job" => "The server is preparing approved photos and applying the reviewed report.",
                "applied" when type == "job" => "iTrader confirmed that the approved stock report was applied.",
                "stopping" => "Stopping after the current job finishes.",
                "stopped" => "Worker stopped.",
                "unauthorised" => "Desktop access expired or was revoked. Sign in again.",
                "unavailable" or "invalid-response" or "invalid-request" => "The request outcome could not be verified. Check Stock Reviews before starting again; it may have completed.",
                "job-failed" => "The stock job failed. Check Stock Reviews before starting again.",
                "conflict" => "The job lease is no longer available. Check Stock Reviews before starting again.",
                "rate-limited" => "iTrader asked this device to pause. Wait a minute before starting again.",
                "failed" => "Checks or processing failed. Review the connection and iTrader job result.",
                _ => null
            };
            if (safe is null) return false;
            output = new OutputEvent(safe, false, ActivityCode(type, state));
            return true;
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException)
        {
            return false;
        }
    }

    public static string ActivityCode(string type, string state) => state switch
    {
        "checking" or "ready" or "waiting" or "processing" or "stopping" or "stopped" => state,
        "staging-photos" or "applied" when type == "job" => state,
        "unauthorised" or "unavailable" or "invalid-response" or "invalid-request" or "job-failed"
            or "conflict" or "rate-limited" or "failed" => "error",
        _ => ""
    };

    private static string? Str(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}

public sealed class WorkerRunner
{
    private readonly Process _process;
    private Task _completed = Task.CompletedTask;
    private readonly object _outputLock = new();
    private readonly List<OutputEvent> _pending = new();
    private Action<string>? _sink;
    private Action<OutputEvent>? _activitySink;
    private int _disposed;
    public event Action<string>? LineReceived
    {
        add { lock (_outputLock) { _sink += value; foreach (var item in _pending) value?.Invoke(item.Display); _pending.Clear(); } }
        remove { lock (_outputLock) { _sink -= value; } }
    }
    public event Action<OutputEvent>? ActivityReceived
    {
        add { lock (_outputLock) { _activitySink += value; foreach (var item in _pending) if (item.Code.Length > 0) value?.Invoke(item); } }
        remove { lock (_outputLock) { _activitySink -= value; } }
    }
    public bool IsRunning
    {
        get {
            if (Volatile.Read(ref _disposed) != 0) return false;
            try { return !_process.HasExited; }
            catch (InvalidOperationException) { return false; }
        }
    }

    private WorkerRunner(Process process)
    {
        _process = process;
    }

    public static bool TryStart(WorkerLaunchPlan plan, out WorkerRunner runner, out string error)
    {
        runner = null!;
        error = "missing_payload";
        var start = new ProcessStartInfo
        {
            FileName = plan.NodePath,
            WorkingDirectory = plan.WorkingDirectory,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };
        foreach (var arg in plan.Arguments) start.ArgumentList.Add(arg);
        start.Environment.Clear();
        foreach (var pair in plan.Environment) start.Environment[pair.Key] = pair.Value;
        try
        {
            var process = new Process { StartInfo = start, EnableRaisingEvents = true };
            if (!process.Start()) return false;
            var started = new WorkerRunner(process);
            runner = started;
            process.OutputDataReceived += (_, e) => started.OnOutput(e.Data);
            process.ErrorDataReceived += (_, _) => { };
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            started._completed = started.WatchAsync();
            try {
                process.StandardInput.WriteLine(plan.StdinJson);
                process.StandardInput.Flush();
            } catch (IOException) {
                process.StandardInput.Close();
                _ = started.WhenExitedAsync();
                return false;
            }
            error = "";
            return true;
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception or IOException)
        {
            error = "missing_payload";
            return false;
        }
    }

    public async Task StopSafelyAsync()
    {
        try { _process.StandardInput.Close(); }
        catch (IOException) { }
        catch (InvalidOperationException) { }
        await WhenExitedAsync();
    }

    public async Task WhenExitedAsync()
    {
        await _completed;
        if (Interlocked.Exchange(ref _disposed, 1) == 0) _process.Dispose();
    }

    private async Task WatchAsync()
    {
        try { await _process.WaitForExitAsync(); }
        catch (InvalidOperationException) { }
    }

    private void OnOutput(string? line)
    {
        if (string.IsNullOrEmpty(line)) return;
        if (WorkerProcess.TryInterpret(line, out var output)) {
            lock (_outputLock) {
                if (output.Code.Length > 0) _activitySink?.Invoke(output);
                if (_sink is null) { if (_pending.Count >= 40) _pending.RemoveAt(0); _pending.Add(output); }
                else _sink.Invoke(output.Display);
            }
        }
    }
}
