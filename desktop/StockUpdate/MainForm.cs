using System.Diagnostics;

namespace StockUpdate;

public sealed class MainForm : Form, IWorkerControlUi
{
    private readonly SessionStore _store = new();
    private readonly RadioButton _preview = new() { Text = "Preview - itrader.dev", Checked = true, AutoSize = true };
    private readonly RadioButton _production = new() { Text = "Production - itrader.im", AutoSize = true };
    private readonly Label _account = new() { AutoSize = true, Text = "Not signed in" };
    private readonly Label _status = new() { AutoSize = true, Text = "Idle" };
    private readonly Label _simpleStatus = new() { AutoSize = true, Text = "Idle", MaximumSize = new Size(420, 0) };
    private readonly Label _environment = new() { AutoSize = true, Text = "Preview - itrader.dev" };
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
    private readonly Button _simpleSignIn = new() { Text = "Sign in", AutoSize = true };
    private readonly Button _simpleStop = new() { Text = "Stop safely", AutoSize = true };
    private readonly Button _simpleCancel = new() { Text = "Cancel sign-in", AutoSize = true, Enabled = false };
    private readonly Button _reviews = new() { Text = "Open stock reviews", AutoSize = true };
    private readonly Button _devices = new() { Text = "Manage devices", AutoSize = true };
    private readonly Button _signOut = new() { Text = "Sign out", AutoSize = true };
    private readonly Button _copy = new() { Text = "Copy redacted diagnostics", AutoSize = true };
    private readonly ToolStripMenuItem _debugLayout = new("Debug layout") { CheckOnClick = true };
    private readonly Control _simpleRoot;
    private readonly Control _debugRoot;
    private readonly List<string> _lines = new();
    private CancellationTokenSource _http = new();
    private WorkerSession? _session;
    private WorkerRunner? _runner;
    private WorkerControlController? _control;
    private bool _busy;
    private bool _closing;
    private bool _shuttingDown;
    private bool _launchControlStarted;

    public MainForm()
    {
        Text = "iTrader Stock Update";
        MinimumSize = new Size(400, 210);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font("Segoe UI", 9f);
        var menu = new MenuStrip();
        var view = new ToolStripMenuItem("View");
        view.DropDownItems.Add(_debugLayout);
        menu.Items.Add(view);
        MainMenuStrip = menu;
        _debugLayout.CheckedChanged += (_, _) => ApplyChrome();

        var env = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(8) };
        env.Controls.AddRange([new Label { Text = "Environment", AutoSize = true, Padding = new Padding(0, 6, 8, 0) }, _preview, _production]);
        var info = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(8, 0, 8, 0) };
        info.Controls.AddRange([_account, new Label { Text = "   ", AutoSize = true }, _status]);
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(8) };
        buttons.Controls.AddRange([_signIn, _cancel, _check, _start, _stop, _reviews, _devices, _signOut, _copy]);
        var debug = new Panel { Dock = DockStyle.Fill, Visible = false };
        debug.Controls.Add(_activity);
        debug.Controls.Add(buttons);
        debug.Controls.Add(info);
        debug.Controls.Add(env);
        _debugRoot = debug;

        var brand = new Label { Text = "iTrader Stock Update", AutoSize = true, Font = new Font("Segoe UI", 16f, FontStyle.Bold) };
        var simpleButtons = new FlowLayoutPanel { AutoSize = true, WrapContents = false };
        simpleButtons.Controls.AddRange([_simpleSignIn, _simpleStop, _simpleCancel]);
        var simple = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
            Padding = new Padding(16),
            AutoScroll = true
        };
        simple.Controls.AddRange([brand, _environment, _simpleStatus, simpleButtons]);
        _simpleRoot = simple;

        Controls.Add(debug);
        Controls.Add(simple);
        Controls.Add(menu);
        _preview.CheckedChanged += (_, _) => OnEnvironmentChanged();
        _production.CheckedChanged += (_, _) => OnEnvironmentChanged();
        _cancel.Click += (_, _) => _http.Cancel();
        _simpleCancel.Click += (_, _) => _http.Cancel();
        _signIn.Click += async (_, _) => await SignInAsync();
        _simpleSignIn.Click += async (_, _) => await SignInAsync();
        _check.Click += async (_, _) => await StartModeAsync("check", confirmProduction: false);
        _start.Click += async (_, _) => await StartModeAsync("watch", confirmProduction: true);
        _stop.Click += async (_, _) => await StopAsync(local: true);
        _simpleStop.Click += async (_, _) => await StopAsync(local: true);
        _reviews.Click += (_, _) => OpenFixed("/admin/stock-reviews", null);
        _devices.Click += (_, _) => OpenFixed("/admin/stock-worker", null);
        _signOut.Click += async (_, _) => await SignOutAsync();
        _copy.Click += (_, _) => CopyDiagnostics();
        ApplyChrome();
        LoadEnvironment();
        Note("Manual controls only. A finished-processing line is not treated as success.");
        Shown += (_, _) => LaunchControl();
    }

    private AppEnvironment Selected => _production.Checked ? AppEnvironment.Production : AppEnvironment.Preview;

    private void ApplyChrome()
    {
        var debug = _debugLayout.Checked;
        _simpleRoot.Visible = !debug;
        _debugRoot.Visible = debug;
        MinimumSize = debug ? new Size(760, 520) : new Size(400, 210);
        if (debug && ClientSize.Width < 760) ClientSize = new Size(760, 520);
        if (!debug && ClientSize.Height > 280) ClientSize = new Size(460, 220);
        Text = debug
            ? "iTrader Stock Update - " + Targets.WireName(Selected) + " (" + Targets.Host(Selected) + ")"
            : "iTrader Stock Update";
    }

    private void OnEnvironmentChanged()
    {
        if (_runner is { IsRunning: true } || _busy) return;
        ReplaceControl(null);
        LoadEnvironment();
    }

    private void LoadEnvironment()
    {
        _environment.Text = (_production.Checked ? "Production - " : "Preview - ") + Targets.Host(Selected);
        if (_debugLayout.Checked)
            Text = "iTrader Stock Update - " + Targets.WireName(Selected) + " (" + Targets.Host(Selected) + ")";
        _session = _store.TryLoad(Selected);
        _account.Text = _session is null ? "Not signed in" : _session.Account.Name + " (" + _session.Account.Email + ")";
        SetStatus(_session is null ? "Idle" : "Signed in");
        UpdateButtons();
    }

    private void LaunchControl()
    {
        if (_launchControlStarted) return;
        _launchControlStarted = true;
        if (_control is null && _session is not null && Selected == AppEnvironment.Preview)
            StartControl(_session);
    }

    private void UpdateButtons()
    {
        var running = _runner is { IsRunning: true };
        var stoppable = running || _control?.State.RuntimeState is "running" or "stopping";
        _preview.Enabled = !running && !_busy;
        _production.Enabled = !running && !_busy;
        _signIn.Enabled = !running && !_busy;
        _simpleSignIn.Enabled = !_busy;
        _simpleSignIn.Text = _session is not null && _control is not null && !_control.State.Paused ? "Open Stock Reviews" : "Sign in";
        _cancel.Enabled = _busy && !running;
        _simpleCancel.Enabled = _busy && !running;
        _signOut.Enabled = !running && !_busy && _session is not null;
        _check.Enabled = !running && !_busy && _session is not null;
        _start.Enabled = !running && !_busy && _session is not null;
        _stop.Enabled = stoppable;
        _simpleStop.Enabled = stoppable;
        _simpleStop.Visible = stoppable;
        _simpleCancel.Visible = _busy && !running;
    }

    private async Task SignInAsync()
    {
        if (_busy) return;
        if (_runner is { IsRunning: true }) { OpenFixed("/admin/stock-reviews", null); return; }
        _busy = true;
        UpdateButtons();
        if (_session is not null && _session.Environment == Selected)
        {
            try
            {
                if (!await RefreshSessionAsync() || _session is null || _shuttingDown || IsDisposed) return;
                StartControl(_session);
                OpenFixed("/admin/stock-reviews", null);
                Note("Signed in to " + Targets.WireName(Selected) + ".");
            }
            catch (Exception) { Note(SafeText.MapError("unavailable")); }
            finally { FinishBusy(); }
            return;
        }
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
            OpenFixed("/admin/stock-reviews", "code=" + begin.Value.UserCode);
            var polled = await api.PollUntilAsync(begin.Value.DeviceCode, verifier, token);
            if (!polled.Ok || polled.Value is null)
            {
                Note(SafeText.MapError(polled.ErrorCode));
                return;
            }
            var session = polled.Value;
            var full = await api.SessionAsync(session.AccessToken, token);
            if (!full.Ok || full.Value is null)
            {
                Note(SafeText.MapError(full.ErrorCode));
                return;
            }
            session = full.Value;
            if (_closing || _shuttingDown || IsDisposed || token.IsCancellationRequested) return;
            _store.Save(session);
            _session = session;
            _account.Text = session.Account.Name + " (" + session.Account.Email + ")";
            SetStatus("Signed in");
            StartControl(session);
            Note("Signed in to " + Targets.WireName(environment) + ".");
        }
        catch (Exception) { Note(SafeText.MapError("unavailable")); }
        finally { FinishBusy(); }
    }

    private async Task StartModeAsync(string mode, bool confirmProduction, int? commandGeneration = null)
    {
        if (_busy || _runner is { IsRunning: true })
        {
            if (commandGeneration is not null && _runner is not { IsRunning: true }) _control?.State.FailStart();
            return;
        }
        var ticket = commandGeneration ?? _control?.State.Generation;
        if (_session is null || _session.Environment != Selected)
        {
            Note(SafeText.MapError("not_signed_in"));
            if (commandGeneration is not null) _control?.State.FailStart();
            return;
        }
        if (confirmProduction && Selected == AppEnvironment.Production)
        {
            var answer = MessageBox.Show(this, "Start the worker on the production site itrader.im?", "Confirm production", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (answer != DialogResult.Yes)
            {
                if (commandGeneration is not null) _control?.State.MarkStopped();
                return;
            }
        }
        _busy = true;
        UpdateButtons();
        try
        {
            if (!await RefreshSessionAsync())
            {
                if (commandGeneration is not null) _control?.State.FailStart();
                return;
            }
            var session = _session;
            if (!WorkerProcess.CanStartWorker(_closing || _shuttingDown, IsDisposed, _http.IsCancellationRequested, session is not null) || session is null)
            {
                if (commandGeneration is not null) _control?.State.FailStart();
                return;
            }
            if (ticket is int generation && _control is not null && !_control.State.CompleteStart(generation)) return;
            var root = Path.GetFullPath(AppContext.BaseDirectory);
            if (!WorkerProcess.TryCreatePlan(root, Selected, session.AccessToken, mode, ParentEnvironment(), out var plan, out var error))
            {
                Note(SafeText.MapError(error));
                if (commandGeneration is not null) _control?.State.FailStart();
                return;
            }
            if (!WorkerRunner.TryStart(plan, out var runner, out error))
            {
                Note(SafeText.MapError(error));
                if (commandGeneration is not null) _control?.State.FailStart();
                return;
            }
            if (ticket is int started && _control is not null && _control.State.IsStale(started))
            {
                await AbandonAsync(runner);
                return;
            }
            _runner = runner;
            runner.ActivityReceived += output =>
            {
                if (output.Code.Length == 0) return;
                _control?.State.Record(output.Code, DateTimeOffset.UtcNow);
                _control?.State.NoteWorker(output.Code);
            };
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
                    var expected = _control?.State.StopWorker == true || _control?.State.RuntimeState is "stopping" or "stopped";
                    _control?.State.ObserveExit();
                    SetStatus(expected ? "Worker stopped" : "Worker needs attention");
                    Note(expected
                        ? "Worker stopped. The app stays connected so the website can start it again."
                        : "The worker process exited and was not restarted. Review the activity. A generic finished line is not verified success.");
                    UpdateButtons();
                    if (_closing || _shuttingDown) Close();
                });
            });
        }
        catch (Exception)
        {
            Note(SafeText.MapError("unavailable"));
            SetStatus("Could not start or check the worker");
            if (commandGeneration is not null) _control?.State.FailStart();
        }
        finally
        {
            _busy = false;
            if (!IsDisposed) UpdateButtons();
            if ((_closing || _shuttingDown) && _runner is null && !IsDisposed) Close();
        }
    }

    private async Task<bool> RefreshSessionAsync()
    {
        if (_session is null) return false;
        RestartHttp();
        using var api = WorkerApiClient.Create(Selected);
        var full = await api.SessionAsync(_session.AccessToken, _http.Token);
        if (!full.Ok || full.Value is null)
        {
            if (full.ErrorCode is "unauthorized" or "forbidden") ClearLocalSession();
            Note(SafeText.MapError(full.ErrorCode));
            return false;
        }
        _session = full.Value;
        _store.Save(full.Value);
        return true;
    }

    private async Task StopAsync(bool local)
    {
        if (local) _control?.State.LocalStop();
        var paused = _control?.State.Paused == true;
        var runner = _runner;
        _stop.Enabled = false;
        _simpleStop.Enabled = false;
        if (runner is null)
        {
            _control?.State.MarkStopped();
            if (!paused && _session is not null) SetStatus("Worker stopped");
            UpdateButtons();
            return;
        }
        if (!paused) SetStatus("Stopping after the current job");
        try { await runner.StopSafelyAsync(); }
        catch (Exception) { Note("Could not confirm worker exit. Keep the application open and review the stock job."); }
        _control?.State.MarkStopped();
        UpdateButtons();
    }

    private async Task SignOutAsync()
    {
        if (_busy || _runner is { IsRunning: true } || _session is null) return;
        _busy = true;
        UpdateButtons();
        ReplaceControl(null);
        var environment = Selected;
        var token = _session.AccessToken;
        RestartHttp();
        var revoked = false;
        try
        {
            using var api = WorkerApiClient.Create(environment);
            revoked = (await api.RevokeAsync(token, _http.Token)).Ok;
        }
        catch (Exception) { revoked = false; }
        _store.Clear(environment);
        _session = null;
        _account.Text = "Not signed in";
        SetStatus("Signed out");
        Note(revoked
            ? "Signed out and the device was revoked."
            : "Signed out on this PC. The server could not revoke the device.");
        _busy = false;
        if (!IsDisposed) UpdateButtons();
        if ((_closing || _shuttingDown) && !IsDisposed) Close();
    }

    private void StartControl(WorkerSession session)
    {
        var bridge = new ControlBridge(this);
        var control = new WorkerControlController(session.Environment, session.AccessToken, bridge);
        bridge.Bind(control);
        ReplaceControl(control);
        control.Start();
    }

    private void ReplaceControl(WorkerControlController? next)
    {
        var previous = _control;
        _control = next;
        previous?.Cancel();
    }

    private void ClearLocalSession()
    {
        _store.Clear(Selected);
        _session = null;
        _account.Text = "Not signed in";
        SetStatus("Not signed in");
    }

    private async Task AbandonAsync(WorkerRunner runner)
    {
        try { await runner.StopSafelyAsync(); }
        catch (Exception) { Note("Could not confirm worker exit. Keep the application open and review the stock job."); }
    }

    private void FinishBusy()
    {
        _busy = false;
        if (!IsDisposed)
        {
            if (_session is null) SetStatus("Not signed in");
            else if (_runner is not { IsRunning: true } && _control is null) SetStatus("Signed in");
            UpdateButtons();
        }
        if ((_closing || _shuttingDown) && _runner is null && !IsDisposed) Close();
    }

    void IWorkerControlUi.Post(Action action)
    {
        if (IsDisposed || !IsHandleCreated) return;
        try { BeginInvoke(action); }
        catch (InvalidOperationException) { }
    }

    void IWorkerControlUi.OnConnected()
    {
        if (_runner is not { IsRunning: true }) SetStatus("Connected — use Stock Reviews to start work");
        UpdateButtons();
    }

    void IWorkerControlUi.OnRemoteCommand(int generation, string action)
    {
        if (_shuttingDown || IsDisposed) return;
        if (action == "stop") { _ = StopAsync(local: false); return; }
        if (action == "start") _ = StartModeAsync("watch", confirmProduction: true, generation);
    }

    void IWorkerControlUi.OnControlLost(string errorCode)
    {
        if (errorCode == "unauthorized") ClearLocalSession();
        else SetStatus("Control disconnected");
        Note(errorCode switch
        {
            "not_found" => "Stock Update control is not available yet. The worker was not started.",
            "unauthorized" => "Sign-in expired or was revoked. Sign in again.",
            _ => "The control connection failed. Sign in again to reconnect. No further job will be taken."
        });
        _ = StopAfterControlLostAsync();
    }

    private async Task StopAfterControlLostAsync()
    {
        await StopAsync(local: false);
        if (!IsDisposed) {
            SetStatus("Connection lost. Click Sign in to reconnect.");
            UpdateButtons();
        }
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
            "Device: " + (_session is null ? "none" : "dev_[redacted]"),
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

    private void SetStatus(string text)
    {
        _status.Text = text;
        _simpleStatus.Text = text;
    }

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
        _shuttingDown = true;
        ReplaceControl(null);
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
            _ = StopAsync(local: true);
        }
        base.OnFormClosing(e);
    }

    private sealed class ControlBridge : IWorkerControlUi
    {
        private readonly MainForm _form;
        private WorkerControlController? _owner;
        public ControlBridge(MainForm form) => _form = form;
        public void Bind(WorkerControlController owner) => _owner = owner;
        private bool Current => _owner is not null && ReferenceEquals(_form._control, _owner);
        public void Post(Action action) { if (Current) ((IWorkerControlUi)_form).Post(action); }
        public void OnConnected() { if (Current) ((IWorkerControlUi)_form).OnConnected(); }
        public void OnRemoteCommand(int generation, string action) { if (Current) ((IWorkerControlUi)_form).OnRemoteCommand(generation, action); }
        public void OnControlLost(string errorCode) { if (Current) ((IWorkerControlUi)_form).OnControlLost(errorCode); }
    }
}
