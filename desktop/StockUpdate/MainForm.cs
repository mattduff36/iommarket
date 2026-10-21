using System.Diagnostics;

namespace StockUpdate;

public sealed class MainForm : Form
{
    private readonly SessionStore _store = new();
    private readonly RadioButton _preview = new() { Text = "Preview - itrader.dev", Checked = true, AutoSize = true };
    private readonly RadioButton _production = new() { Text = "Production - itrader.im", AutoSize = true };
    private readonly Label _account = new() { AutoSize = true, Text = "Not signed in" };
    private readonly Label _status = new() { AutoSize = true, Text = "Idle" };
    private readonly TextBox _activity = new()
    {
        Multiline = true,
        ReadOnly = true,
        ScrollBars = ScrollBars.Vertical,
        Dock = DockStyle.Fill,
        Font = new Font("Segoe UI", 9f)
    };
    private readonly Button _signIn = new() { Text = "Sign in", AutoSize = true };
    private readonly Button _cancel = new() { Text = "Cancel sign-in", AutoSize = true, Enabled = false };
    private readonly Button _check = new() { Text = "Check connection", AutoSize = true };
    private readonly Button _start = new() { Text = "Start worker", AutoSize = true };
    private readonly Button _stop = new() { Text = "Stop safely", AutoSize = true };
    private readonly Button _admin = new() { Text = "Open dealer admin", AutoSize = true };
    private readonly Button _devices = new() { Text = "Manage devices", AutoSize = true };
    private readonly Button _signOut = new() { Text = "Sign out", AutoSize = true };
    private readonly Button _copy = new() { Text = "Copy redacted diagnostics", AutoSize = true };
    private readonly List<string> _lines = new();
    private CancellationTokenSource _http = new();
    private WorkerSession? _session;
    private Dictionary<string, string>? _config;
    private WorkerRunner? _runner;
    private bool _busy;
    private bool _closing;

    public MainForm()
    {
        Text = "iTrader Stock Update";
        MinimumSize = new Size(760, 520);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font("Segoe UI", 9f);
        var env = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(8) };
        env.Controls.AddRange([new Label { Text = "Environment", AutoSize = true, Padding = new Padding(0, 6, 8, 0) }, _preview, _production]);
        var info = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(8, 0, 8, 0) };
        info.Controls.AddRange([_account, new Label { Text = "   ", AutoSize = true }, _status]);
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(8) };
        buttons.Controls.AddRange([_signIn, _cancel, _check, _start, _stop, _admin, _devices, _signOut, _copy]);
        Controls.Add(_activity);
        Controls.Add(buttons);
        Controls.Add(info);
        Controls.Add(env);
        _preview.CheckedChanged += (_, _) => OnEnvironmentChanged();
        _production.CheckedChanged += (_, _) => OnEnvironmentChanged();
        _cancel.Click += (_, _) => _http.Cancel();
        _signIn.Click += async (_, _) => await SignInAsync();
        _check.Click += async (_, _) => await StartModeAsync("check", confirmProduction: false);
        _start.Click += async (_, _) => await StartModeAsync("watch", confirmProduction: true);
        _stop.Click += async (_, _) => await StopAsync();
        _admin.Click += (_, _) => OpenFixed("/admin/dealers", null);
        _devices.Click += (_, _) => OpenFixed("/admin/stock-worker", null);
        _signOut.Click += async (_, _) => await SignOutAsync();
        _copy.Click += (_, _) => CopyDiagnostics();
        LoadEnvironment();
        Note("Manual controls only. A finished-processing line is not treated as success.");
    }

    private AppEnvironment Selected => _production.Checked ? AppEnvironment.Production : AppEnvironment.Preview;

    private void OnEnvironmentChanged()
    {
        if (_runner is { IsRunning: true } || _busy) return;
        LoadEnvironment();
    }

    private void LoadEnvironment()
    {
        Text = "iTrader Stock Update - " + Targets.WireName(Selected) + " (" + Targets.Host(Selected) + ")";
        _config = null;
        _session = _store.TryLoad(Selected);
        _account.Text = _session is null ? "Not signed in" : _session.Account.Name + " (" + _session.Account.Email + ")";
        SetStatus(_session is null ? "Idle" : "Signed in");
        UpdateButtons();
    }

    private void UpdateButtons()
    {
        var running = _runner is { IsRunning: true };
        _preview.Enabled = !running && !_busy;
        _production.Enabled = !running && !_busy;
        _signIn.Enabled = !running && !_busy;
        _cancel.Enabled = _busy && !running;
        _signOut.Enabled = !running && !_busy && _session is not null;
        _check.Enabled = !running && !_busy && _session is not null;
        _start.Enabled = !running && !_busy && _session is not null;
        _stop.Enabled = running;
    }

    private async Task SignInAsync()
    {
        if (_busy || _runner is { IsRunning: true }) return;
        _busy = true;
        UpdateButtons();
        RestartHttp();
        var token = _http.Token;
        var environment = Selected;
        try
        {
            var (verifier, challenge) = Pkce.Create();
            using var api = WorkerApiClient.Create(environment);
            SetStatus("Waiting for browser approval");
            var begin = await api.BeginAsync(SafeText.DeviceName(), challenge, token);
            if (!begin.Ok || begin.Value is null)
            {
                Note(SafeText.MapError(begin.ErrorCode));
                return;
            }
            Note("Browser authorisation code: " + begin.Value.UserCode + ". Approve only this computer and environment.");
            OpenExact(begin.Value.BrowserUrl);
            var polled = await api.PollUntilAsync(begin.Value.DeviceCode, verifier, token);
            if (!polled.Ok || polled.Value is null)
            {
                Note(SafeText.MapError(polled.ErrorCode));
                return;
            }
            var session = polled.Value;
            var full = await api.SessionAsync(session.AccessToken, true, token);
            if (!full.Ok || full.Value?.Config is null)
            {
                Note(SafeText.MapError(full.ErrorCode.Length == 0 ? "missing_config" : full.ErrorCode));
                return;
            }
            session = full.Value;
            if (_closing || IsDisposed || token.IsCancellationRequested) return;
            _store.Save(session);
            _session = session;
            _config = new Dictionary<string, string>(session.Config, StringComparer.Ordinal);
            _account.Text = session.Account.Name + " (" + session.Account.Email + ")";
            SetStatus("Signed in");
            Note("Signed in to " + Targets.WireName(environment) + ".");
        }
        catch (Exception)
        {
            Note(SafeText.MapError("unavailable"));
        }
        finally
        {
            _busy = false;
            if (!IsDisposed) { SetStatus(_session is null ? "Not signed in" : "Signed in"); UpdateButtons(); }
            if (_closing && _runner is null && !IsDisposed) Close();
        }
    }

    private async Task StartModeAsync(string mode, bool confirmProduction)
    {
        if (_busy || _runner is { IsRunning: true }) return;
        if (_session is null || _session.Environment != Selected)
        {
            Note(SafeText.MapError("not_signed_in"));
            return;
        }
        if (confirmProduction && Selected == AppEnvironment.Production)
        {
            var answer = MessageBox.Show(this, "Start the worker on the production site itrader.im?", "Confirm production", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (answer != DialogResult.Yes) return;
        }
        _busy = true;
        UpdateButtons();
        try
        {
            if (!await RefreshConfigAsync()) return;
            // Closing or cancelling while the connection request was completing
            // must not start a new worker that keeps the window alive.
            if (!WorkerProcess.CanStartWorker(_closing, IsDisposed, _http.IsCancellationRequested, _session is not null)) return;
            var root = Path.GetFullPath(AppContext.BaseDirectory);
            if (!WorkerProcess.TryCreatePlan(root, Selected, _session.AccessToken, _config!, mode, ParentEnvironment(), out var plan, out var error))
            {
                Note(SafeText.MapError(error));
                return;
            }
            if (!WorkerRunner.TryStart(plan, out var runner, out error))
            {
                Note(SafeText.MapError(error));
                return;
            }
            _runner = runner;
            runner.LineReceived += line => { if (!IsDisposed && IsHandleCreated) BeginInvoke(() => { Note(line); SetStatus(line); }); };
            SetStatus(mode == "check" ? "Checking connection" : "Worker running");
            Note(mode == "check" ? "Connection check started." : "Worker started.");
            UpdateButtons();
            var observed = runner;
            _ = Task.Run(async () =>
            {
                await observed.WhenExitedAsync();
                if (IsDisposed || !IsHandleCreated) return;
                BeginInvoke(() =>
                {
                    if (!ReferenceEquals(_runner, observed)) return;
                    _runner = null;
                    SetStatus("Worker stopped");
                    Note("The worker process exited. Review the activity. A generic finished line is not verified success.");
                    UpdateButtons();
                    if (_closing) Close();
                });
            });
        }
        catch (Exception)
        {
            Note(SafeText.MapError("unavailable"));
            SetStatus("Could not start or check the worker");
        }
        finally
        {
            _busy = false;
            if (!IsDisposed) UpdateButtons();
            if (_closing && _runner is null && !IsDisposed) Close();
        }
    }

    private async Task<bool> RefreshConfigAsync()
    {
        if (_session is null) return false;
        RestartHttp();
        using var api = WorkerApiClient.Create(Selected);
        var full = await api.SessionAsync(_session.AccessToken, true, _http.Token);
        if (!full.Ok || full.Value is null)
        {
            if (full.ErrorCode is "unauthorized" or "forbidden")
            {
                _store.Clear(Selected);
                _session = null;
                _config = null;
                _account.Text = "Not signed in";
            }
            Note(SafeText.MapError(full.ErrorCode));
            return false;
        }
        if (full.Value.Config is null)
        {
            Note(SafeText.MapError("missing_config"));
            return false;
        }
        _session = full.Value;
        _config = new Dictionary<string, string>(full.Value.Config, StringComparer.Ordinal);
        _store.Save(full.Value);
        return true;
    }

    private async Task StopAsync()
    {
        var runner = _runner;
        if (runner is null) return;
        SetStatus("Stopping after the current job");
        _stop.Enabled = false;
        try { await runner.StopSafelyAsync(); }
        catch (Exception) { Note("Could not confirm worker exit. Keep the application open and review the stock job."); }
    }

    private async Task SignOutAsync()
    {
        if (_busy || _runner is { IsRunning: true } || _session is null) return;
        _busy = true;
        UpdateButtons();
        var environment = Selected;
        var token = _session.AccessToken;
        RestartHttp();
        var revoked = false;
        try
        {
            using var api = WorkerApiClient.Create(environment);
            var result = await api.RevokeAsync(token, _http.Token);
            revoked = result.Ok;
        }
        catch (Exception)
        {
            revoked = false;
        }
        _store.Clear(environment);
        _session = null;
        _config = null;
        _account.Text = "Not signed in";
        SetStatus("Signed out");
        Note(revoked
            ? "Signed out and the device was revoked."
            : "Signed out on this PC. The server could not revoke the device.");
        _busy = false;
        if (!IsDisposed) UpdateButtons();
        if (_closing && !IsDisposed) Close();
    }

    private void OpenFixed(string path, string? query)
    {
        if (!Targets.TryFixedHttps(Selected, path, query, out var uri)) return;
        OpenExact(uri.AbsoluteUri);
    }

    private static void OpenExact(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != "https") return;
        if (!string.Equals(uri.Host, Targets.PreviewHost, StringComparison.Ordinal)
            && !string.Equals(uri.Host, Targets.ProductionHost, StringComparison.Ordinal))
            return;
        try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
        catch (System.ComponentModel.Win32Exception) { MessageBox.Show("Could not open the browser. Open iTrader in your normal browser.", "iTrader Stock Update"); }
    }

    private void CopyDiagnostics()
    {
        var running = _runner is { IsRunning: true };
        var text = string.Join(System.Environment.NewLine, new[]
        {
            "iTrader Stock Update " + Targets.ClientVersion,
            "Environment: " + Targets.WireName(Selected),
            "Signed in: " + (_session is not null),
            "Account: " + (_session is null ? "none" : SafeText.Email(_session.Account.Email)),
            "Device: " + (_session is null ? "none" : "dev_ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦"),
            "Worker: " + (running ? "running" : "idle"),
            "Activity:"
        }.Concat(_lines));
        try { Clipboard.SetText(text); Note("Copied redacted diagnostics."); }
        catch (Exception) { Note("Could not copy diagnostics."); }
    }

    private void Note(string message)
    {
        _lines.Add(DateTimeOffset.Now.ToString("HH:mm:ss") + "  " + message);
        if (_lines.Count > 200) _lines.RemoveAt(0);
        _activity.Text = string.Join(System.Environment.NewLine, _lines);
        _activity.SelectionStart = _activity.TextLength;
        _activity.ScrollToCaret();
    }

    private void SetStatus(string text) => _status.Text = text;

    private void RestartHttp()
    {
        _http.Cancel();
        _http.Dispose();
        _http = new CancellationTokenSource();
    }

    private static Dictionary<string, string> ParentEnvironment()
    {
        var copy = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (System.Collections.DictionaryEntry entry in System.Environment.GetEnvironmentVariables())
        {
            if (entry.Key is string key && entry.Value is string value) copy[key] = value;
        }
        return copy;
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        _http.Cancel();
        if (_busy)
        {
            e.Cancel = true;
            _closing = true;
            SetStatus("Cancelling the current connection request");
        }
        if (_runner is { IsRunning: true })
        {
            e.Cancel = true;
            if (_closing) return;
            _closing = true;
            SetStatus("Waiting for the current job to finish");
            _ = StopAsync();
        }
        base.OnFormClosing(e);
    }
}
