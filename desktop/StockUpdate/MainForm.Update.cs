namespace StockUpdate;

public sealed partial class MainForm
{
    public string? PendingInstaller { get; private set; }
    private AppEnvironment? _updateChecked;

    private async Task<bool> CheckUpdateAsync(WorkerSession session)
    {
        if (_updateChecked == session.Environment) return true;
        if (_runner is { IsRunning: true }) return false;
        _updateChecked = session.Environment;
        SetStatus("Checking for an update");
        try
        {
            var update = await UpdateClient.CheckAsync(session, _http.Token);
            if (_closing || _shuttingDown || IsDisposed) return false;
            if (update is null) return true;
            using var prompt = new Form { Text = "Stock Update available", StartPosition = FormStartPosition.CenterParent, ClientSize = new Size(420, 150), FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false };
            var text = new Label { Text = $"Version {update.Manifest.Version} is available.\nUpdate before starting work? Your sign-in will be kept.", AutoSize = false, Location = new Point(20, 20), Size = new Size(380, 60) };
            var yes = new Button { Text = "Update now", DialogResult = DialogResult.Yes, Location = new Point(185, 100), Size = new Size(100, 30) };
            var no = new Button { Text = "Not now", DialogResult = DialogResult.No, Location = new Point(295, 100), Size = new Size(100, 30) };
            prompt.Controls.AddRange([text, yes, no]);
            prompt.AcceptButton = yes;
            prompt.CancelButton = no;
            if (prompt.ShowDialog(this) != DialogResult.Yes) return true;
            // A modal may remain open beyond the signed URL's ten-minute lifetime.
            var fresh = await UpdateClient.CheckAsync(session, _http.Token);
            if (fresh is null || fresh.Manifest != update.Manifest) throw new InvalidDataException();
            update = fresh;
            SetStatus("Downloading verified update");
            using var client = UpdateDownload.CreateClient();
            var progress = new Progress<int>(value => { if (!IsDisposed) SetStatus($"Downloading update… {value}%"); });
            PendingInstaller = await UpdateDownload.SaveAsync(client, update.Manifest, update.DownloadUrl, _http.Token, progress);
            if (_closing || _shuttingDown || IsDisposed) { PendingInstaller = null; return false; }
            // FinishBusy closes the form; Program releases the single-instance mutex before setup.
            _closing = true;
            return false;
        }
        catch (Exception)
        {
            Note("Could not check or download the update. The installed version remains available; try again next time you open the app.");
            return !_closing && !_shuttingDown;
        }
        finally { if (!_closing && !IsDisposed) SetStatus("Signed in"); }
    }

    private async Task LaunchWithUpdateAsync()
    {
        if (_launchControlStarted) return;
        _launchControlStarted = true;
        if (_session is null) return;
        _busy = true;
        UpdateButtons();
        try { if (await CheckUpdateAsync(_session) && !_shuttingDown) StartControl(_session); }
        finally { FinishBusy(); }
    }
}
