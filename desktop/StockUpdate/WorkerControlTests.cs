using System.Net;
using System.Text;
using System.Text.Json;

namespace StockUpdate;

public static class WorkerControlTests
{
    public static void Transport()
    {
        var token = Token();
        var instance = Guid.Parse("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
        using var timedOut = Client(_ => throw new OperationCanceledException());
        Assert(Heartbeat(timedOut, instance, token).ErrorCode == "unavailable");
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        Assert(timedOut.HeartbeatAsync(instance, "connected", [], null, token, cancelled.Token).GetAwaiter().GetResult().ErrorCode == "cancelled");
        using var malformed = Client(_ => Json(HttpStatusCode.OK, "{\"ok\":true}"));
        var missing = Heartbeat(malformed, instance, token);
        Assert(!missing.Ok && missing.ErrorCode == "invalid_response" && missing.Value is null);

        using var extra = Client(_ => Json(HttpStatusCode.OK, "{\"ok\":true,\"command\":null,\"note\":\"secret\"}"));
        Assert(Heartbeat(extra, instance, token).ErrorCode == "invalid_response");

        var command = "{\"id\":\"" + instance.ToString("D") + "\",\"instanceId\":\"" + instance.ToString("D") + "\",\"action\":\"start\",\"extra\":true}";
        using var shaped = Client(_ => Json(HttpStatusCode.OK, "{\"ok\":true,\"command\":" + command + "}"));
        Assert(Heartbeat(shaped, instance, token).ErrorCode == "invalid_response");

        using var badAction = Client(_ => Json(HttpStatusCode.OK, "{\"ok\":true,\"command\":{\"id\":\"" + instance.ToString("D") + "\",\"instanceId\":\"" + instance.ToString("D") + "\",\"action\":\"watch\"}}"));
        Assert(Heartbeat(badAction, instance, token).ErrorCode == "invalid_response");

        using var html = Client(_ => new HttpResponseMessage(HttpStatusCode.InternalServerError)
        {
            Content = new StringContent("<html>" + token + "</html>", Encoding.UTF8, "text/html")
        });
        var hidden = Heartbeat(html, instance, token);
        Assert(!hidden.Ok && hidden.ErrorCode == "unavailable" && hidden.Value is null);

        var calls = 0;
        using var redirected = Client(_ =>
        {
            calls++;
            var response = new HttpResponseMessage(HttpStatusCode.Redirect);
            response.Headers.Location = new Uri("https://evil.example/steal");
            return response;
        });
        var redirect = Heartbeat(redirected, instance, token);
        Assert(!redirect.Ok && redirect.ErrorCode == "redirect_rejected" && calls == 1);

        using var oversize = Client(_ =>
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[WorkerControlClient.MaxResponseBytes + 1]) };
            response.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/json");
            return response;
        });
        Assert(Heartbeat(oversize, instance, token).ErrorCode == "invalid_response");
        Assert(WorkerControlClient.MaxResponseBytes == 16 * 1024);
        Assert(WorkerControlClient.HeartbeatInterval == TimeSpan.FromSeconds(10));
    }

    public static void Identity()
    {
        var token = Token();
        var instance = Guid.Parse("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
        var ack = Guid.Parse("bbbbbbbb-cccc-4ddd-8eee-ffffffffffff");
        var now = new DateTimeOffset(2026, 10, 22, 20, 1, 2, 7, TimeSpan.Zero);
        Assert(WorkerControlClient.FormatUtc(now) == "2026-10-22T20:01:02.007Z");
        string? seen = null;
        using var api = Client(request =>
        {
            Assert(request.RequestUri!.AbsoluteUri == "https://itrader.dev/api/stock-worker/control");
            Assert(request.Headers.Authorization?.Scheme == "Bearer" && request.Headers.Authorization.Parameter == token);
            Assert(request.Headers.Contains("Cookie") == false);
            seen = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            Assert(!seen.Contains(token, StringComparison.Ordinal));
            using var body = JsonDocument.Parse(seen);
            Assert(SessionParser.ExactFields(body.RootElement, "op", "instanceId", "state", "activity", "acknowledgedCommandId"));
            Assert(body.RootElement.GetProperty("op").GetString() == "heartbeat");
            Assert(body.RootElement.GetProperty("instanceId").GetString() == instance.ToString("D"));
            Assert(body.RootElement.GetProperty("state").GetString() == "connected");
            Assert(body.RootElement.GetProperty("acknowledgedCommandId").GetString() == ack.ToString("D"));
            var activity = body.RootElement.GetProperty("activity");
            Assert(activity.GetArrayLength() == 1);
            var item = activity[0];
            Assert(SessionParser.ExactFields(item, "sequence", "code", "at"));
            Assert(item.GetProperty("code").GetString() == "waiting");
            Assert(item.GetProperty("at").GetString() == "2026-10-22T20:01:02.007Z");
            var id = instance.ToString("D");
            return Json(HttpStatusCode.OK, "{\"ok\":true,\"command\":{\"id\":\"" + id + "\",\"instanceId\":\"" + id + "\",\"action\":\"stop\"}}");
        });
        var reply = api.HeartbeatAsync(instance, "connected", [new WorkerActivityItem(1, "waiting", now)], ack, token, CancellationToken.None).GetAwaiter().GetResult();
        Assert(reply.Ok && reply.Value is not null && reply.Value.Action == "stop" && reply.Value.InstanceId == instance);
        Assert(seen is not null);
    }

    public static void StateRules()
    {
        var state = new WorkerControlState();
        var now = DateTimeOffset.UtcNow;
        state.Record("waiting", now);
        state.Record("waiting", now.AddSeconds(5));
        state.Record("Waiting for queued work. token " + Token(), now);
        state.Record("processing", now.AddSeconds(6));
        state.Record("waiting", now.AddSeconds(7));
        var items = state.Snapshot(now.AddSeconds(8), out _, out _, out _);
        Assert(items.Length == 3);
        Assert(items[0].Code == "waiting" && items[1].Code == "processing" && items[2].Code == "waiting");
        Assert(items[0].Sequence < items[1].Sequence && items[1].Sequence < items[2].Sequence);

        var aged = new WorkerControlState();
        aged.Record("ready", now.AddHours(-23).AddSeconds(-1));
        aged.Record("applied", now);
        var kept = aged.Snapshot(now, out _, out _, out _);
        Assert(kept.Length == 1 && kept[0].Code == "applied");
        var edge = new WorkerControlState();
        edge.Record("ready", now.AddHours(-23));
        edge.Record("checking", now);
        Assert(edge.Snapshot(now, out _, out _, out _).Length == 2);

        var full = new WorkerControlState();
        for (var i = 0; i < 41; i++) full.Record(i % 2 == 0 ? "processing" : "ready", now.AddSeconds(i));
        var capped = full.Snapshot(now.AddMinutes(2), out _, out _, out _);
        Assert(capped.Length == 40 && capped[0].Sequence == 2);
        for (var i = 1; i < capped.Length; i++) Assert(capped[i].Sequence > capped[i - 1].Sequence);

        var instance = state.InstanceId;
        var id = Guid.NewGuid();
        Assert(state.TryAccept(id, instance, "start", out _, out var first) && first);
        Assert(state.TryAccept(id, instance, "start", out _, out var replay) && !replay);
        Assert(state.AcknowledgedCommandId == id);
        var ack = state.AcknowledgedCommandId;
        Assert(!state.TryAccept(Guid.NewGuid(), Guid.NewGuid(), "stop", out _, out _));
        Assert(state.AcknowledgedCommandId == ack);
    }

    public static void Races()
    {
        var state = new WorkerControlState();
        var instance = state.InstanceId;
        var id = Guid.NewGuid();
        Assert(state.TryAccept(id, instance, "start", out var generation, out var execute) && execute);
        state.LocalStop();
        Assert(!state.CompleteStart(generation));
        Assert(state.IsStale(generation));
        Assert(state.StopWorker && state.RuntimeState == "stopping" && state.InstanceId != instance);
        Assert(!state.TryAccept(id, instance, "start", out _, out _));
        state.MarkStopped();
        Assert(!state.StopWorker && state.RuntimeState == "stopped");

        var lost = new WorkerControlState();
        Assert(lost.TryAccept(Guid.NewGuid(), lost.InstanceId, "start", out var ticket, out var started) && started);
        lost.Record("processing", DateTimeOffset.UtcNow);
        lost.OnControlLost();
        Assert(lost.Paused && lost.StopWorker && lost.RuntimeState == "error");
        Assert(!lost.CompleteStart(ticket));
        lost.Record("processing", DateTimeOffset.UtcNow);
        Assert(lost.Snapshot(DateTimeOffset.UtcNow, out _, out var runtime, out _).Length == 1);
        Assert(runtime == "error");
        lost.ObserveExit();
        Assert(lost.RuntimeState == "error");
    }

    public static void OutputCodes()
    {
        var secret = Token();
        Assert(WorkerProcess.TryInterpret("{\"type\":\"status\",\"state\":\"waiting\",\"message\":\"" + secret + "\"}", out var waiting));
        Assert(waiting.Code == "waiting" && !waiting.Display.Contains(secret, StringComparison.Ordinal));
        Assert(WorkerProcess.TryInterpret("{\"type\":\"job\",\"state\":\"processing-finished\",\"message\":\"" + secret + "\"}", out var finished));
        Assert(finished.UnverifiedFinish && finished.Code == "processing-finished" && !finished.Display.Contains(secret, StringComparison.Ordinal));
        Assert(WorkerProcess.TryInterpret("{\"type\":\"error\",\"state\":\"job-failed\",\"message\":\"" + secret + "\"}", out var failed));
        Assert(failed.Code == "error" && !failed.Display.Contains(secret, StringComparison.Ordinal));
        Assert(WorkerProcess.TryInterpret("{\"type\":\"check\",\"state\":\"passed\",\"message\":\"" + secret + "\"}", out var passed));
        Assert(passed.Code.Length == 0 && !passed.Display.Contains(secret, StringComparison.Ordinal));
        Assert(WorkerProcess.ActivityCode("status", "unauthorised") == "error");
    }

    private static ApiCall<WorkerControlCommand?> Heartbeat(WorkerControlClient client, Guid instance, string token) =>
        client.HeartbeatAsync(instance, "connected", [], null, token, CancellationToken.None).GetAwaiter().GetResult();

    private static WorkerControlClient Client(Func<HttpRequestMessage, HttpResponseMessage> next) =>
        new(AppEnvironment.Preview, new ScriptHandler(next), ownsHandler: false);

    private static void Assert(bool condition)
    {
        if (!condition) throw new InvalidOperationException("assertion");
    }

    private static string Token() => new('a', 43);

    private static HttpResponseMessage Json(HttpStatusCode status, string body)
    {
        var response = new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        response.Headers.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue { NoStore = true };
        return response;
    }

    private sealed class ScriptHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, HttpResponseMessage> _next;
        public ScriptHandler(Func<HttpRequestMessage, HttpResponseMessage> next) => _next = next;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(_next(request));
    }
}
