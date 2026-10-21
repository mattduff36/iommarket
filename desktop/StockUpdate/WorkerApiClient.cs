using System.Net;
using System.Text;
using System.Text.Json;

namespace StockUpdate;

public sealed record ApiCall<T>(bool Ok, T? Value, string ErrorCode)
{
    public static ApiCall<T> Success(T value) => new(true, value, "");
    public static ApiCall<T> Fail(string code) => new(false, default, code);
}

public sealed record BeginInfo(string DeviceCode, string UserCode, string BrowserUrl);

public sealed class WorkerApiClient : IDisposable
{
    private readonly HttpClient _http;
    private readonly HttpMessageHandler _handler;
    private readonly bool _ownsHandler;

    public AppEnvironment Environment { get; }

    public WorkerApiClient(AppEnvironment environment, HttpMessageHandler handler, bool ownsHandler = true)
    {
        Environment = environment;
        _handler = handler;
        _ownsHandler = ownsHandler;
        _http = new HttpClient(handler, disposeHandler: false)
        {
            Timeout = TimeSpan.FromSeconds(30)
        };
    }

    public static WorkerApiClient Create(AppEnvironment environment)
    {
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            UseCookies = false,
            AutomaticDecompression = DecompressionMethods.None,
            ConnectTimeout = TimeSpan.FromSeconds(15)
        };
        return new WorkerApiClient(environment, handler);
    }

    public async Task<ApiCall<BeginInfo>> BeginAsync(string deviceName, string codeChallenge, CancellationToken cancellationToken)
    {
        if (!TokenShapes.Base64Url(codeChallenge, 43)) return ApiCall<BeginInfo>.Fail("invalid_request");
        var body = JsonSerializer.Serialize(new
        {
            op = "begin",
            deviceName,
            codeChallenge,
            environment = Targets.WireName(Environment),
            clientVersion = Targets.ClientVersion
        });
        var call = await PostAsync(body, null, cancellationToken);
        if (!call.Ok || call.Value is null) return ApiCall<BeginInfo>.Fail(call.ErrorCode);
        if (call.Value.StatusCode != 200 || call.Value.Json is null) return ApiCall<BeginInfo>.Fail(call.Value.StatusCode is >= 300 and < 400 ? "redirect_rejected" : MapStatus(call.Value));
        if (!TryBegin(call.Value.Json, out var info)) return ApiCall<BeginInfo>.Fail("invalid_response");
        return ApiCall<BeginInfo>.Success(info);
    }

    public async Task<ApiCall<WorkerSession?>> PollOnceAsync(string deviceCode, string codeVerifier, CancellationToken cancellationToken)
    {
        if (!TokenShapes.Base64Url(deviceCode, 43) || !TokenShapes.Base64Url(codeVerifier, 43))
            return ApiCall<WorkerSession?>.Fail("invalid_request");
        var body = JsonSerializer.Serialize(new { op = "poll", deviceCode, codeVerifier });
        var call = await PostAsync(body, null, cancellationToken);
        if (!call.Ok || call.Value is null) return ApiCall<WorkerSession?>.Fail(call.ErrorCode);
        if (call.Value.StatusCode == 202)
            return HasStatus(call.Value.Json, "pending") ? ApiCall<WorkerSession?>.Success(null) : ApiCall<WorkerSession?>.Fail("invalid_response");
        if (call.Value.StatusCode == 200 && call.Value.Json is not null && SessionParser.TryParse(call.Value.Json, Environment, false, out var session))
            return ApiCall<WorkerSession?>.Success(session);
        return ApiCall<WorkerSession?>.Fail(call.Value.StatusCode is >= 300 and < 400 ? "redirect_rejected" : MapStatus(call.Value));
    }

    public async Task<ApiCall<WorkerSession>> PollUntilAsync(string deviceCode, string codeVerifier, CancellationToken cancellationToken, Func<CancellationToken, Task>? wait = null)
    {
        wait ??= token => Task.Delay(TimeSpan.FromSeconds(5), token);
        var deadline = DateTimeOffset.UtcNow.AddMinutes(10);
        while (DateTimeOffset.UtcNow < deadline)
        {
            var once = await PollOnceAsync(deviceCode, codeVerifier, cancellationToken);
            if (!once.Ok) return ApiCall<WorkerSession>.Fail(once.ErrorCode);
            if (once.Value is not null) return ApiCall<WorkerSession>.Success(once.Value);
            if (DateTimeOffset.UtcNow.AddSeconds(5) >= deadline) break;
            await wait(cancellationToken);
        }
        return ApiCall<WorkerSession>.Fail("expired");
    }

    public async Task<ApiCall<WorkerSession>> SessionAsync(string accessToken, bool includeConfig, CancellationToken cancellationToken)
    {
        if (!TokenShapes.Base64Url(accessToken, 43)) return ApiCall<WorkerSession>.Fail("invalid_request");
        var body = JsonSerializer.Serialize(new { op = "session", includeConfig });
        var call = await PostAsync(body, accessToken, cancellationToken);
        if (!call.Ok || call.Value is null) return ApiCall<WorkerSession>.Fail(call.ErrorCode);
        if (call.Value.StatusCode == 200 && call.Value.Json is not null && SessionParser.TryParse(call.Value.Json, Environment, includeConfig, out var session) && session.AccessToken == accessToken)
            return ApiCall<WorkerSession>.Success(session);
        return ApiCall<WorkerSession>.Fail(call.Value.StatusCode is >= 300 and < 400 ? "redirect_rejected" : MapStatus(call.Value));
    }

    public async Task<ApiCall<bool>> RevokeAsync(string accessToken, CancellationToken cancellationToken)
    {
        if (!TokenShapes.Base64Url(accessToken, 43)) return ApiCall<bool>.Fail("invalid_request");
        var call = await PostAsync("{\"op\":\"revoke\"}", accessToken, cancellationToken);
        if (!call.Ok || call.Value is null) return ApiCall<bool>.Fail(call.ErrorCode);
        if (call.Value.StatusCode == 200 && call.Value.Json is not null && IsRevoked(call.Value.Json))
            return ApiCall<bool>.Success(true);
        return ApiCall<bool>.Fail(call.Value.StatusCode is >= 300 and < 400 ? "redirect_rejected" : MapStatus(call.Value));
    }

    private static bool IsRevoked(string json) => HasStatus(json, "revoked");

    private static bool HasStatus(string? json, string expected)
    {
        if (json is null) return false;
        try {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.ValueKind == JsonValueKind.Object &&
                doc.RootElement.TryGetProperty("status", out var status) &&
                status.ValueKind == JsonValueKind.String && status.GetString() == expected;
        } catch (JsonException) { return false; }
    }

    private bool TryBegin(string json, out BeginInfo info)
    {
        info = null!;
        try
        {
            using var doc = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 6 });
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return false;
            if (!root.TryGetProperty("interval", out var interval) || !interval.TryGetInt32(out var seconds) || seconds != 5 ||
                !root.TryGetProperty("expiresIn", out var expires) || !expires.TryGetInt32(out var lifetime) || lifetime != 600) return false;
            var device = root.TryGetProperty("deviceCode", out var d) ? d.GetString() : null;
            var user = root.TryGetProperty("userCode", out var u) ? u.GetString() : null;
            var uriText = root.TryGetProperty("verificationUri", out var v) ? v.GetString() : null;
            if (!TokenShapes.Base64Url(device, 43) || !TokenShapes.UserCode(user)) return false;
            if (!Targets.TryFixedHttps(Environment, "/admin/stock-worker", "code=" + user, out var expected)) return false;
            if (!Uri.TryCreate(uriText, UriKind.Absolute, out var given) || given != expected) return false;
            info = new BeginInfo(device!, user!, expected.AbsoluteUri);
            return true;
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException)
        {
            return false;
        }
    }

    private async Task<ApiCall<RawReply>> PostAsync(string json, string? bearer, CancellationToken cancellationToken)
    {
        if (!Targets.TryFixedHttps(Environment, "/api/stock-worker", null, out var uri))
            return ApiCall<RawReply>.Fail("invalid_request");
        using var request = new HttpRequestMessage(HttpMethod.Post, uri);
        request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        request.Headers.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue { NoStore = true };
        if (bearer is not null) request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", bearer);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(30));
        try
        {
            using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            if ((int)response.StatusCode is >= 300 and < 400) return ApiCall<RawReply>.Fail("redirect_rejected");
            var body = await ReadLimitedAsync(response, deadline.Token);
            if (body is null) return ApiCall<RawReply>.Fail("invalid_response");
            var media = response.Content.Headers.ContentType?.MediaType;
            if (!string.Equals(media, "application/json", StringComparison.OrdinalIgnoreCase))
                return ApiCall<RawReply>.Success(new RawReply((int)response.StatusCode, null));
            return ApiCall<RawReply>.Success(new RawReply((int)response.StatusCode, body));
        }
        catch (OperationCanceledException)
        {
            return ApiCall<RawReply>.Fail("cancelled");
        }
        catch (Exception ex) when (ex is HttpRequestException or IOException)
        {
            return ApiCall<RawReply>.Fail("unavailable");
        }
    }

    private static async Task<string?> ReadLimitedAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        var buffer = new byte[65537];
        var read = 0;
        while (read < buffer.Length)
        {
            var n = await stream.ReadAsync(buffer.AsMemory(read), cancellationToken);
            if (n == 0) break;
            read += n;
        }
        if (read > 65536) return null;
        return Encoding.UTF8.GetString(buffer, 0, read);
    }

    private static string MapStatus(RawReply reply)
    {
        if (reply.Json is not null && SessionParser.TryErrorCode(reply.Json, out var code)) return code;
        if (reply.StatusCode == 503 || reply.StatusCode >= 500) return "unavailable";
        return reply.StatusCode is 400 or 401 or 403 or 429 ? "unavailable" : "invalid_response";
    }

    public void Dispose()
    {
        _http.Dispose();
        if (_ownsHandler) _handler.Dispose();
    }

    private sealed record RawReply(int StatusCode, string? Json);
}
