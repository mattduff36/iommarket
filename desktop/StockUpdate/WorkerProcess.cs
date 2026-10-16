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

public readonly record struct OutputEvent(string Display, bool UnverifiedFinish);

public static class WorkerProcess
{
    public const string UnverifiedFinishMessage =
        "The worker reported finished processing. Check the result in the iTrader admin page. This is not a verified success.";

    private static readonly string[] AllowedParent =
    [
        "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
        "COMSPEC", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "OS",
        "USERNAME", "USERDOMAIN", "SYSTEMDRIVE"
    ];

    public static bool CanStartWorker(bool closing, bool disposed, bool cancelled, bool authorised) =>
        !closing && !disposed && !cancelled && authorised;

    public static bool TryCreatePlan(
        string appRoot,
        AppEnvironment environment,
        string accessToken,
        IReadOnlyDictionary<string, string> config,
        string mode,
        IReadOnlyDictionary<string, string> parentEnvironment,
        out WorkerLaunchPlan plan,
        out string error)
    {
        plan = null!;
        error = "missing_payload";
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
        env["PLAYWRIGHT_BROWSERS_PATH"] = browsers;
        var stdin = JsonSerializer.Serialize(new
        {
            environment = Targets.WireName(environment),
            accessToken,
            config
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
                output = new OutputEvent(UnverifiedFinishMessage, true);
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
                "stopping" => "Stopping after the current job finishes.",
                "stopped" => "Worker stopped.",
                "unauthorised" => "Desktop access expired or was revoked. Sign in again.",
                "unavailable" or "invalid-response" => "Desktop access could not be verified. No new job was started.",
                "failed" => "Checks or processing failed. Review the connection and iTrader job result.",
                _ => null
            };
            if (safe is null) return false;
            output = new OutputEvent(safe, false);
            return true;
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException)
        {
            return false;
        }
    }

    private static string? Str(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}

public sealed class WorkerRunner
{
    private readonly Process _process;
    private Task _completed = Task.CompletedTask;
    private readonly object _outputLock = new();
    private readonly List<string> _pending = new();
    private Action<string>? _sink;
    private int _disposed;
    public event Action<string>? LineReceived
    {
        add { lock (_outputLock) { _sink += value; foreach (var line in _pending) value?.Invoke(line); _pending.Clear(); } }
        remove { lock (_outputLock) { _sink -= value; } }
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
                if (_sink is null) { if (_pending.Count >= 40) _pending.RemoveAt(0); _pending.Add(output.Display); }
                else _sink.Invoke(output.Display);
            }
        }
    }
}
