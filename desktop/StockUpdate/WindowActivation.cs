using System.Diagnostics;
using System.IO.Pipes;
using System.Security.Principal;
using System.Text;

namespace StockUpdate;

internal sealed class WindowActivation : IDisposable
{
    internal static string PipeName => "iTrader.StockUpdate.Activate." + WindowsIdentity.GetCurrent().User?.Value + "." + Process.GetCurrentProcess().SessionId;
    private readonly CancellationTokenSource _cancel = new();
    private readonly Task _listener;

    internal WindowActivation(MainForm form)
    {
        _ = form.Handle;
        _listener = ListenAsync(form);
    }

    internal static bool Signal(string value)
    {
        try
        {
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            using var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
            pipe.ConnectAsync(deadline.Token).GetAwaiter().GetResult();
            pipe.WriteAsync(Encoding.UTF8.GetBytes(value + "\n"), deadline.Token).AsTask().GetAwaiter().GetResult();
            var ack = new byte[1];
            return pipe.ReadAsync(ack, deadline.Token).AsTask().GetAwaiter().GetResult() == 1 && ack[0] == 1;
        }
        catch (Exception ex) when (ex is IOException or OperationCanceledException or UnauthorizedAccessException) { return false; }
    }

    private async Task ListenAsync(MainForm form)
    {
        while (!_cancel.IsCancellationRequested)
        {
            try
            {
                await using var pipe = new NamedPipeServerStream(PipeName, PipeDirection.InOut, 1,
                    PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(_cancel.Token).ConfigureAwait(false);
                using var deadline = CancellationTokenSource.CreateLinkedTokenSource(_cancel.Token);
                deadline.CancelAfter(TimeSpan.FromSeconds(3));
                var frame = new List<byte>();
                var one = new byte[1];
                while (frame.Count <= 180 && await pipe.ReadAsync(one, deadline.Token).ConfigureAwait(false) == 1 && one[0] != 10) frame.Add(one[0]);
                var value = new UTF8Encoding(false, true).GetString(frame.ToArray());
                var valid = one[0] == 10 && (value == "activate" || LaunchRequest.TryParse(value, out _));
                if (valid && !form.IsDisposed)
                    form.BeginInvoke(() => { if (value == "activate") form.ActivateManual(); else _ = form.AcceptLaunchAsync(value); });
                await pipe.WriteAsync(new byte[] { valid ? (byte)1 : (byte)0 }, deadline.Token).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is IOException or OperationCanceledException or UnauthorizedAccessException or InvalidOperationException or DecoderFallbackException)
            {
                if (_cancel.IsCancellationRequested) return;
            }
        }
    }

    public void Dispose() { _cancel.Cancel(); }
}
