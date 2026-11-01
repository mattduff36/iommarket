using System.Net;
using System.Text;
using System.Text.Json;

namespace StockUpdate;

public static class LaunchTests
{
    private static readonly string Token = new('a', 43);
    private static readonly string Job = "c" + new string('b', 24);
    private static string Link => "itrader-stock-update://launch?environment=production&ticket=" + Token;
    private static void Assert(bool condition) { if (!condition) throw new InvalidOperationException("assertion"); }
    private static string Reply(string mode = "task", string[]? jobs = null, bool close = true) => JsonSerializer.Serialize(new {
        session = new { accessToken = Token, deviceId = "dev_" + new string('b', 22), expiresAt = DateTimeOffset.UtcNow.AddDays(1).ToString("O"), environment = "production", account = new { id = "admin", name = "Admin", email = "admin@example.com" } },
        launchId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", mode, jobIds = jobs ?? [Job], closeAfterRun = close
    });

    public static void Parser()
    {
        Assert(LaunchRequest.TryParse(Link, out var launch) && launch.Environment == AppEnvironment.Production);
        Assert(!launch.ToString().Contains(Token));
        foreach (var invalid in new[] { Link + "#x", Link + "&x=1", Link + "&ticket=" + Token, Link.Replace("launch?", "launch/?"),
            Link.Replace("launch?", "launch:443?"), Link.Replace("launch?", "user@launch?"), Link.Replace("production", "local"), Link.Replace("ticket=", "ticket=%61"), Link + "\n", Link.ToUpperInvariant(), " " + Link })
            Assert(!LaunchRequest.TryParse(invalid, out _));
        Assert(LaunchReply.TryParse(Reply(), AppEnvironment.Production, out var task) && task.JobIds.SequenceEqual(new[] { Job }));
        Assert(!LaunchReply.TryParse(Reply(), AppEnvironment.Preview, out _));
        Assert(!LaunchReply.TryParse(Reply(jobs: []), AppEnvironment.Production, out _));
        Assert(!LaunchReply.TryParse(Reply(jobs: [Job, Job]), AppEnvironment.Production, out _));
        Assert(!LaunchReply.TryParse(Reply(close: false), AppEnvironment.Production, out _));
        Assert(LaunchReply.TryParse(Reply("open", [], false), AppEnvironment.Production, out _));
        Assert(!LaunchReply.ValidJobIds(["job;command"]));
        Assert(!LaunchReply.ValidJobIds(Enumerable.Range(0, 101).Select(x => "c" + x.ToString().PadLeft(24, '0')).ToArray()));
    }

    public static void Transport()
    {
        Assert(LaunchRequest.TryParse(Link, out var launch));
        using var api = new WorkerApiClient(AppEnvironment.Production, new Handler((request, _) => {
            Assert(request.RequestUri!.AbsoluteUri == "https://itrader.im/api/stock-worker/launch");
            Assert(request.Headers.Authorization?.Parameter == Token && !request.Headers.Contains("Cookie"));
            using var body = JsonDocument.Parse(request.Content!.ReadAsStringAsync().GetAwaiter().GetResult());
            Assert(SessionParser.ExactFields(body.RootElement, "op", "ticket", "deviceName", "clientVersion"));
            Assert(body.RootElement.GetProperty("ticket").GetString() == Token);
            return Task.FromResult(Json(Reply()));
        }));
        Assert(api.RedeemLaunchAsync(launch, Token, CancellationToken.None).GetAwaiter().GetResult().Ok);
        using var redirect = new WorkerApiClient(AppEnvironment.Production, new Handler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.Redirect))));
        Assert(redirect.RedeemLaunchAsync(launch, null, CancellationToken.None).GetAwaiter().GetResult().ErrorCode == "redirect_rejected");
    }

    public static void Close()
    {
        var state = new WorkerControlState();
        Assert(!state.TryAccept(Guid.NewGuid(), Guid.NewGuid(), "close", out _, out _));
        var id = Guid.NewGuid();
        Assert(state.TryAccept(id, state.InstanceId, "close", out _, out var execute) && execute && state.StopWorker);
        Assert(state.TryAccept(id, state.InstanceId, "close", out _, out execute) && !execute);
        var begun = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var states = new List<string>();
        var launch = Guid.NewGuid();
        var handler = new Handler(async (request, cancel) => {
            using var doc = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancel));
            var runtime = doc.RootElement.GetProperty("state").GetString()!;
            Assert(doc.RootElement.GetProperty("launchId").GetString() == launch.ToString("D"));
            lock (states) states.Add(runtime);
            if (runtime != "disconnected") { begun.TrySetResult(); await Task.Delay(30000, cancel); }
            return Json("{\"ok\":true,\"command\":null}");
        });
        using var controller = new WorkerControlController(AppEnvironment.Production, Token, new Ui(), handler, launch);
        controller.Start();
        Assert(begun.Task.Wait(TimeSpan.FromSeconds(2)));
        controller.DisconnectAsync().GetAwaiter().GetResult();
        controller.DisconnectAsync().GetAwaiter().GetResult();
        Assert(states.SequenceEqual(new[] { "connected", "disconnected" }));
    }

    public static void Ipc()
    {
        Assert(WindowActivation.PipeName.Contains(System.Security.Principal.WindowsIdentity.GetCurrent().User!.Value));
        var previous = SynchronizationContext.Current;
        try
        {
            using var form = new MainForm();
            using var listener = new WindowActivation(form);
            Assert(WindowActivation.Signal(Link));
            Assert(!WindowActivation.Signal(Link + "&unknown=1"));
            Assert(!WindowActivation.Signal(new string('x', 200)));
        }
        finally { SynchronizationContext.SetSynchronizationContext(previous); }
    }

    private sealed class Ui : IWorkerControlUi
    {
        public void Post(Action action) { }
        public void OnConnected() { }
        public void OnRemoteCommand(int generation, string action) { }
        public void OnControlLost(string errorCode) { }
    }
    private static HttpResponseMessage Json(string body) => new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
    private sealed class Handler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> action) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => action(request, cancellationToken);
    }
}
