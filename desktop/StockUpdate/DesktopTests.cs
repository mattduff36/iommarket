using System.Net;
using System.Text;
using System.Text.Json;

namespace StockUpdate;

public static class DesktopTests
{
    public static int Run(string reportPath)
    {
        var results = new List<TestResult>();
        void Check(string name, Action body)
        {
            try
            {
                body();
                results.Add(new TestResult(name, true, "ok"));
            }
            catch (Exception ex)
            {
                results.Add(new TestResult(name, false, ex.GetType().Name));
            }
        }

        Check("targets-are-fixed-https", () =>
        {
            Assert(Targets.Api(AppEnvironment.Preview) == "https://itrader.dev/api/stock-worker");
            Assert(Targets.Api(AppEnvironment.Production) == "https://itrader.im/api/stock-worker");
        });
        Check("pkce-lengths", () =>
        {
            var (verifier, challenge) = Pkce.Create();
            Assert(TokenShapes.Base64Url(verifier, 43));
            Assert(challenge == Pkce.ChallengeFor(verifier));
            Assert(TokenShapes.Base64Url(challenge, 43));
        });
        Check("session-dto-and-cross-target", () =>
        {
            Assert(SessionParser.TryParse(SessionJson(AppEnvironment.Preview, DateTimeOffset.UtcNow.AddDays(1), true), AppEnvironment.Preview, true, out var session));
            Assert(session.Config is not null && session.Config["FEED"] == "one");
            Assert(!SessionParser.TryParse(SessionJson(AppEnvironment.Production, DateTimeOffset.UtcNow.AddDays(1), false), AppEnvironment.Preview, false, out _));
            Assert(!SessionParser.TryParse(SessionJson(AppEnvironment.Preview, DateTimeOffset.UtcNow.AddMinutes(-5), false), AppEnvironment.Preview, false, out _));
            Assert(SessionParser.TryErrorCode("{\"error\":\"invalid_grant\"}", out var code) && code == "invalid_grant");
            Assert(!SessionParser.TryErrorCode("<html>secret-body</html>", out _));
        });
        Check("http-preview-poll-redirect-and-html", () =>
        {
            var calls = new List<Uri>();
            var step = 0;
            var handler = new ScriptHandler(request =>
            {
                calls.Add(request.RequestUri!);
                Assert(request.RequestUri!.Host == "itrader.dev");
                step++;
                if (step == 1) return Json(HttpStatusCode.Accepted, "{\"status\":\"pending\"}");
                if (step == 2) return Json(HttpStatusCode.OK, SessionJson(AppEnvironment.Preview, DateTimeOffset.UtcNow.AddHours(1), false));
                return new HttpResponseMessage(HttpStatusCode.Redirect) { Headers = { Location = new Uri("https://evil.example/steal") } };
            });
            using var api = new WorkerApiClient(AppEnvironment.Preview, handler, ownsHandler: false);
            var pending = api.PollOnceAsync(Token(), Token(), CancellationToken.None).GetAwaiter().GetResult();
            Assert(pending.Ok && pending.Value is null);
            var ready = api.PollOnceAsync(Token(), Token(), CancellationToken.None).GetAwaiter().GetResult();
            Assert(ready.Ok && ready.Value is not null && ready.Value.Environment == AppEnvironment.Preview);
            var redirected = api.PollOnceAsync(Token(), Token(), CancellationToken.None).GetAwaiter().GetResult();
            Assert(!redirected.Ok && redirected.ErrorCode == "redirect_rejected");
            Assert(calls.Count == 3);
            Assert(calls.All(uri => uri.Host == "itrader.dev"));
            var html = new ScriptHandler(_ => new HttpResponseMessage(HttpStatusCode.InternalServerError)
            {
                Content = new StringContent("<html>secret-body</html>", Encoding.UTF8, "text/html")
            });
            using var htmlApi = new WorkerApiClient(AppEnvironment.Preview, html, ownsHandler: false);
            var hidden = htmlApi.SessionAsync(Token(), false, CancellationToken.None).GetAwaiter().GetResult();
            Assert(!hidden.Ok && hidden.ErrorCode == "unavailable");
        });
        Check("begin-rejects-foreign-verification-uri", () =>
        {
            var handler = new ScriptHandler(_ => Json(HttpStatusCode.OK, "{\"deviceCode\":\"" + Token() + "\",\"userCode\":\"ABCD1234\",\"verificationUri\":\"https://evil.example/admin/stock-worker?code=ABCD1234\",\"expiresIn\":600,\"interval\":5}"));
            using var api = new WorkerApiClient(AppEnvironment.Production, handler, ownsHandler: false);
            var begin = api.BeginAsync("Desk", Pkce.ChallengeFor(Token()), CancellationToken.None).GetAwaiter().GetResult();
            Assert(!begin.Ok && begin.ErrorCode == "invalid_response" && begin.Value is null);
        });
        Check("begin-accepts-canonical-uri-without-authorization", () =>
        {
            var user = "ABCD1234";
            var canonical = "https://itrader.im/admin/stock-worker?code=" + user;
            string? auth = "unset";
            var handler = new ScriptHandler(request =>
            {
                auth = request.Headers.Authorization?.Scheme;
                Assert(request.RequestUri!.Host == "itrader.im");
                return Json(HttpStatusCode.OK, "{\"deviceCode\":\"" + Token() + "\",\"userCode\":\"" + user + "\",\"verificationUri\":\"" + canonical + "\",\"expiresIn\":600,\"interval\":5}");
            });
            using var api = new WorkerApiClient(AppEnvironment.Production, handler, ownsHandler: false);
            var begin = api.BeginAsync("Desk", Pkce.ChallengeFor(Token()), CancellationToken.None).GetAwaiter().GetResult();
            Assert(begin.Ok && begin.Value!.BrowserUrl == canonical);
            Assert(auth is null);
        });
        Check("poll-respects-cancellation", () =>
        {
            var waits = 0;
            var handler = new ScriptHandler(_ => Json(HttpStatusCode.Accepted, "{\"status\":\"pending\"}"));
            using var api = new WorkerApiClient(AppEnvironment.Preview, handler, ownsHandler: false);
            using var cts = new CancellationTokenSource();
            var task = api.PollUntilAsync(Token(), Token(), cts.Token, _ =>
            {
                waits++;
                cts.Cancel();
                return Task.CompletedTask;
            });
            var result = task.GetAwaiter().GetResult();
            Assert(!result.Ok && result.ErrorCode == "cancelled" && waits == 1);
        });
        Check("dpapi-roundtrip-corrupt-and-expired", () =>
        {
            var root = Path.Combine(Path.GetTempPath(), "itrader-stock-update-tests", Guid.NewGuid().ToString("N"));
            var store = new SessionStore(root);
            var session = Parse(AppEnvironment.Preview, DateTimeOffset.UtcNow.AddDays(2));
            store.Save(session);
            var loaded = store.TryLoad(AppEnvironment.Preview);
            Assert(loaded is not null && loaded.AccessToken == session.AccessToken && loaded.Config is null);
            File.WriteAllBytes(store.PathFor(AppEnvironment.Preview), [1, 2, 3, 4, 5]);
            Assert(store.TryLoad(AppEnvironment.Preview) is null);
            Assert(!File.Exists(store.PathFor(AppEnvironment.Preview)));
            store.Save(Parse(AppEnvironment.Production, DateTimeOffset.UtcNow.AddMinutes(-1)));
            Assert(store.TryLoad(AppEnvironment.Production) is null);
            store.Save(Parse(AppEnvironment.Preview, DateTimeOffset.UtcNow.AddDays(1)));
            Assert(store.TryLoad(AppEnvironment.Production) is null);
        });
        Check("launch-plan-is-bundled-and-redacted", () =>
        {
            var root = Path.Combine(Path.GetTempPath(), "itrader-stock-update-layout", Guid.NewGuid().ToString("N"));
            var worker = Path.Combine(root, "worker");
            Directory.CreateDirectory(Path.Combine(root, "runtime"));
            Directory.CreateDirectory(Path.Combine(worker, "node_modules"));
            Directory.CreateDirectory(Path.Combine(worker, "scripts", "dealer-stock-sync"));
            Directory.CreateDirectory(Path.Combine(root, "browsers"));
            File.WriteAllBytes(Path.Combine(root, "runtime", "node.exe"), [0x4D, 0x5A]);
            File.WriteAllText(Path.Combine(worker, "tsconfig.json"), "{}");
            File.WriteAllText(Path.Combine(worker, "scripts", "dealer-stock-sync", "desktop-worker.ts"), "export {};");
            var token = Token();
            var parent = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["PATH"] = @"C:\Windows\system32",
                ["SYSTEMROOT"] = @"C:\Windows",
                ["NODE_OPTIONS"] = "--experimental-bad",
                ["NODE_TLS_REJECT_UNAUTHORIZED"] = "0",
                ["AWS_SECRET_ACCESS_KEY"] = "secret-value"
            };
            Assert(WorkerProcess.TryCreatePlan(root, AppEnvironment.Preview, token, new Dictionary<string, string> { ["FEED"] = "one" }, "check", parent, out var plan, out _));
            Assert(plan.NodePath == Path.Combine(root, "runtime", "node.exe"));
            Assert(plan.WorkingDirectory == Path.Combine(root, "worker"));
            Assert(string.Join(" ", plan.Arguments) == "--import tsx scripts/dealer-stock-sync/desktop-worker.ts --mode check");
            Assert(!string.Join(" ", plan.Arguments).Contains(token, StringComparison.Ordinal));
            Assert(plan.Environment.ContainsKey("PLAYWRIGHT_BROWSERS_PATH"));
            Assert(plan.Environment["PLAYWRIGHT_BROWSERS_PATH"] == Path.Combine(root, "browsers"));
            Assert(!plan.Environment.ContainsKey("NODE_OPTIONS"));
            Assert(!plan.Environment.ContainsKey("NODE_TLS_REJECT_UNAUTHORIZED"));
            Assert(!plan.Environment.ContainsKey("AWS_SECRET_ACCESS_KEY"));
            using var stdin = JsonDocument.Parse(plan.StdinJson);
            Assert(stdin.RootElement.GetProperty("accessToken").GetString() == token);
            Assert(stdin.RootElement.GetProperty("environment").GetString() == "preview");
            File.Delete(plan.NodePath);
            Assert(!WorkerProcess.TryCreatePlan(root, AppEnvironment.Preview, token, new Dictionary<string, string>(), "watch", parent, out _, out var error));
            Assert(error == "missing_payload");
            Assert(WorkerProcess.TryInterpret("{\"type\":\"job\",\"state\":\"done\",\"message\":\"finished processing listings\"}", out var output));
            Assert(output.UnverifiedFinish && output.Display == WorkerProcess.UnverifiedFinishMessage);
            Assert(!WorkerProcess.TryInterpret("raw failure with token " + token, out _));
        });

        Check("child-json-never-displays-secrets", () =>
        {
            var secret = Token();
            Assert(WorkerProcess.TryInterpret("{\"type\":\"status\",\"state\":\"waiting\",\"message\":\"" + secret + "\"}", out var parsed));
            Assert(!parsed.Display.Contains(secret, StringComparison.Ordinal));
            Assert(!WorkerProcess.TryInterpret("[]", out _));
            Assert(!WorkerProcess.TryInterpret("{\"type\":\"status\",\"state\":\"unknown\",\"message\":\"" + secret + "\"}", out _));
        });
        Check("rejects-malformed-json-shapes", () =>
        {
            Assert(!SessionParser.TryErrorCode("[]", out _));
            using var api = new WorkerApiClient(AppEnvironment.Preview, new ScriptHandler(_ => Json(HttpStatusCode.OK, "{\"interval\":\"five\"}")));
            Assert(!api.BeginAsync("Desk", Pkce.ChallengeFor(Token()), CancellationToken.None).GetAwaiter().GetResult().Ok);
        });
        Check("revoke-requires-exact-status", () =>
        {
            using var api = new WorkerApiClient(AppEnvironment.Preview, new ScriptHandler(_ => Json(HttpStatusCode.OK, "{\"message\":\"revoked\"}")));
            Assert(!api.RevokeAsync(Token(), CancellationToken.None).GetAwaiter().GetResult().Ok);
        });

        Check("late-authorisation-cannot-start-after-close-or-cancel", () =>
        {
            Assert(WorkerProcess.CanStartWorker(false, false, false, true));
            Assert(!WorkerProcess.CanStartWorker(true, false, false, true));
            Assert(!WorkerProcess.CanStartWorker(false, true, false, true));
            Assert(!WorkerProcess.CanStartWorker(false, false, true, true));
            Assert(!WorkerProcess.CanStartWorker(false, false, false, false));
        });
        Check("poll-rejects-false-pending-response", () =>
        {
            using var api = new WorkerApiClient(AppEnvironment.Preview,
                new ScriptHandler(_ => Json(HttpStatusCode.Accepted, "{\"error\":\"unavailable\"}")));
            var reply = api.PollOnceAsync(Token(), Token(), CancellationToken.None).GetAwaiter().GetResult();
            Assert(!reply.Ok && reply.ErrorCode == "invalid_response");
        });

        var passed = results.All(result => result.Passed);
        var report = JsonSerializer.Serialize(new { passed, results }, new JsonSerializerOptions { WriteIndented = true });
        if (!string.IsNullOrWhiteSpace(reportPath))
        {
            var full = Path.GetFullPath(reportPath);
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            File.WriteAllText(full, report);
        }
        return passed ? 0 : 1;
    }

    private static void Assert(bool condition)
    {
        if (!condition) throw new InvalidOperationException("assertion");
    }

    private static string Token() => new('a', 43);

    private static WorkerSession Parse(AppEnvironment environment, DateTimeOffset expires) 
    {
        Assert(SessionParser.TryParse(SessionJson(environment, expires, false), environment, false, out var session) || expires <= DateTimeOffset.UtcNow);
        if (expires <= DateTimeOffset.UtcNow)
        {
            return new WorkerSession(Token(), "dev_" + new string('b', 22), expires, environment, new AccountInfo("acct", "Ada", "ada@example.com"), null);
        }
        return session;
    }

    private static string SessionJson(AppEnvironment environment, DateTimeOffset expires, bool config) =>
        "{\"accessToken\":\"" + Token() + "\",\"deviceId\":\"dev_" + new string('b', 22) + "\",\"expiresAt\":\"" + expires.UtcDateTime.ToString("O") + "\",\"environment\":\"" + Targets.WireName(environment) + "\",\"account\":{\"id\":\"acct\",\"name\":\"Ada\",\"email\":\"ada@example.com\"}" + (config ? ",\"config\":{\"FEED\":\"one\"}" : "") + "}";

    private static HttpResponseMessage Json(HttpStatusCode status, string body)
    {
        var response = new HttpResponseMessage(status)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json")
        };
        response.Headers.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue { NoStore = true };
        return response;
    }

    private sealed record TestResult(string Name, bool Passed, string Detail);

    private sealed class ScriptHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, HttpResponseMessage> _next;
        public ScriptHandler(Func<HttpRequestMessage, HttpResponseMessage> next) => _next = next;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(_next(request));
    }
}
