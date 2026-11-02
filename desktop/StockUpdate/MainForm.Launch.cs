namespace StockUpdate;

public sealed partial class MainForm
{
    private string? _initialLaunch;
    private bool _webOwned;
    private bool _autoCloseTask;
    private bool _shutdownComplete;
    private Guid? _launchId;
    private string[]? _taskJobIds;

    protected override bool ShowWithoutActivation => _webOwned;

    internal void ActivateManual()
    {
        if (_shuttingDown || IsDisposed) return;
        // Opening the app manually claims its lifetime; a background task must not close it.
        _webOwned = false;
        _autoCloseTask = false;
        ShowInTaskbar = true;
        Show();
        WindowState = FormWindowState.Normal;
        BringToFront();
        Activate();
    }

    internal async Task AcceptLaunchAsync(string value)
    {
        if (!LaunchRequest.TryParse(value, out var request) || _busy || _runner is { IsRunning: true } || _shuttingDown) return;
        _busy = true;
        UpdateButtons();
        var task = false;
        try
        {
            RestartHttp();
            var previousSession = _store.TryLoad(request.Environment);
            using var api = WorkerApiClient.Create(request.Environment);
            var result = await api.RedeemLaunchAsync(request, previousSession?.AccessToken, _http.Token);
            if (!result.Ok || result.Value is null || _shuttingDown) { Note("Website launch could not be verified. Return to Stock Reviews to try again."); return; }
            var reply = result.Value;
            if (!_webOwned && _session is not null && _session.Account.Id != reply.Session.Account.Id)
            {
                Note("Website launch belongs to another account. Sign out before switching accounts.");
                return;
            }
            var old = _control;
            _control = null;
            if (old is not null) await old.DisconnectAsync();
            if (_shuttingDown) return;
            if (Selected != request.Environment) _site.TrySwitch(false, false, () => true);
            _store.Save(reply.Session);
            LoadEnvironment();
            _session = reply.Session;
            _launchId = reply.LaunchId;
            _launchControlStarted = true;
            _taskJobIds = reply.Mode == "task" ? reply.JobIds : null;
            _autoCloseTask = _webOwned && reply.CloseAfterRun;
            StartControl(reply.Session);
            task = reply.Mode == "task";
            if (!task) ActivateManual();
            Note(task ? "Running the jobs requested by Stock Reviews." : "Connected from Stock Reviews.");
        }
        catch (Exception) { Note("Website launch could not be completed. Check Stock Reviews before trying again."); }
        finally
        {
            _busy = false;
            UpdateButtons();
            if (!task && _webOwned) Close();
        }
        if (task && !_shuttingDown) await StartModeAsync("watch", confirmProduction: false);
    }

    private async Task ShutdownAsync()
    {
        SetStatus("Closing after the current job finishes");
        _http.Cancel();
        _control?.State.NoteWorker("stopping");
        try
        {
            await StopAsync(local: false);
            if (_runner is { IsRunning: true }) throw new InvalidOperationException();
            // Cancelled connection/launch operations must unwind before transport is finalized.
            while (_busy && !IsDisposed) await Task.Delay(25);
            var control = _control;
            _control = null;
            if (control is not null) await control.DisconnectAsync();
        }
        catch (Exception)
        {
            _shuttingDown = false;
            _closing = false;
            _autoCloseTask = false;
            Note("Could not confirm safe shutdown. Keep the app open and check Stock Reviews.");
            return;
        }
        _shutdownComplete = true;
        if (!IsDisposed) Close();
    }
}
