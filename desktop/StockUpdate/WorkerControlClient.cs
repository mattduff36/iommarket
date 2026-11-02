using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace StockUpdate;

public sealed record WorkerControlCommand(Guid Id, Guid InstanceId, string Action);

public sealed class WorkerControlClient : IDisposable
{
    public const int MaxResponseBytes = 16 * 1024;
    public static readonly TimeSpan HeartbeatInterval = TimeSpan.FromSeconds(10);
    private readonly HttpClient _http;
    private readonly HttpMessageHandler _handler;
    private readonly bool _ownsHandler;

    public AppEnvironment Environment { get; }

    public WorkerControlClient(AppEnvironment environment, HttpMessageHandler handler, bool ownsHandler = true)
    {
        if (!Enum.IsDefined(environment)) throw new ArgumentOutOfRangeException(nameof(environment));
        Environment = environment;
        _handler = handler;
        _ownsHandler = ownsHandler;
        _http = new HttpClient(handler, disposeHandler: false) { Timeout = HeartbeatInterval };
    }

    public static WorkerControlClient Create(AppEnvironment environment)
    {
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            UseCookies = false,
            AutomaticDecompression = DecompressionMethods.None,
            ConnectTimeout = HeartbeatInterval
        };
        return new WorkerControlClient(environment, handler);
    }

    public static string FormatUtc(DateTimeOffset at) =>
        at.ToUniversalTime().UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    public static bool Uuid(string? value)
    {
        if (value is null || value.Length != 36) return false;
        for (var i = 0; i < value.Length; i++)
        {
            var ch = value[i];
            if (i is 8 or 13 or 18 or 23) { if (ch != '-') return false; continue; }
            if (ch is not ((>= '0' and <= '9') or (>= 'a' and <= 'f') or (>= 'A' and <= 'F'))) return false;
        }
        var version = value[14];
        var variant = char.ToLowerInvariant(value[19]);
        return version is >= '1' and <= '8' && variant is '8' or '9' or 'a' or 'b';
    }

    public async Task<ApiCall<WorkerControlCommand?>> HeartbeatAsync(
        Guid instanceId,
        string state,
        IReadOnlyList<WorkerActivityItem> activity,
        Guid? acknowledgedCommandId,
        string bearer,
        CancellationToken cancellationToken,
        Guid? launchId = null)
    {
        if (!TokenShapes.Base64Url(bearer, 43) || !WorkerControlState.IsRuntime(state) || activity.Count > WorkerControlState.MaxEvents)
            return ApiCall<WorkerControlCommand?>.Fail("invalid_request");
        string json;
        try { json = WriteBody(instanceId, state, activity, acknowledgedCommandId, launchId); }
        catch (InvalidOperationException) { return ApiCall<WorkerControlCommand?>.Fail("invalid_request"); }
        if (!Targets.TryFixedHttps(Environment, "/api/stock-worker/control", null, out var uri))
            return ApiCall<WorkerControlCommand?>.Fail("invalid_request");
        using var request = new HttpRequestMessage(HttpMethod.Post, uri);
        request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        request.Headers.CacheControl = new CacheControlHeaderValue { NoStore = true };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(HeartbeatInterval);
        try
        {
            using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            if ((int)response.StatusCode is >= 300 and < 400) return ApiCall<WorkerControlCommand?>.Fail("redirect_rejected");
            var body = await ReadLimitedAsync(response, deadline.Token);
            if (body is null) return ApiCall<WorkerControlCommand?>.Fail("invalid_response");
            var media = response.Content.Headers.ContentType?.MediaType;
            var parsed = string.Equals(media, "application/json", StringComparison.OrdinalIgnoreCase) ? body : null;
            if ((int)response.StatusCode == 404) return ApiCall<WorkerControlCommand?>.Fail("not_found");
            if ((int)response.StatusCode == 401) return ApiCall<WorkerControlCommand?>.Fail("unauthorized");
            if ((int)response.StatusCode != 200 || parsed is null || !TryResponse(parsed, out var command))
                return ApiCall<WorkerControlCommand?>.Fail(MapStatus((int)response.StatusCode, parsed));
            return ApiCall<WorkerControlCommand?>.Success(command);
        }
        catch (OperationCanceledException) { return ApiCall<WorkerControlCommand?>.Fail(cancellationToken.IsCancellationRequested ? "cancelled" : "unavailable"); }
        catch (Exception ex) when (ex is HttpRequestException or IOException) { return ApiCall<WorkerControlCommand?>.Fail("unavailable"); }
    }

    private static string WriteBody(Guid instanceId, string state, IReadOnlyList<WorkerActivityItem> activity, Guid? acknowledgedCommandId, Guid? launchId)
    {
        using var stream = new MemoryStream();
        using var writer = new Utf8JsonWriter(stream);
        writer.WriteStartObject();
        writer.WriteString("op", "heartbeat");
        writer.WriteString("instanceId", instanceId.ToString("D"));
        writer.WriteString("state", state);
        if (launchId is Guid launch) writer.WriteString("launchId", launch.ToString("D"));
        writer.WritePropertyName("activity");
        writer.WriteStartArray();
        var previous = 0;
        var counted = 0;
        foreach (var item in activity)
        {
            if (!WorkerControlState.IsActivity(item.Code) || item.Sequence <= previous) throw new InvalidOperationException();
            previous = item.Sequence;
            counted++;
            writer.WriteStartObject();
            writer.WriteNumber("sequence", item.Sequence);
            writer.WriteString("code", item.Code);
            writer.WriteString("at", FormatUtc(item.At));
            writer.WriteEndObject();
        }
        if (counted > WorkerControlState.MaxEvents) throw new InvalidOperationException();
        writer.WriteEndArray();
        writer.WritePropertyName("acknowledgedCommandId");
        if (acknowledgedCommandId is Guid ack) writer.WriteStringValue(ack.ToString("D"));
        else writer.WriteNullValue();
        writer.WriteEndObject();
        writer.Flush();
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private static bool TryResponse(string json, out WorkerControlCommand? command)
    {
        command = null;
        try
        {
            using var doc = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 6, CommentHandling = JsonCommentHandling.Disallow });
            var root = doc.RootElement;
            if (!SessionParser.ExactFields(root, "ok", "command")) return false;
            if (!root.TryGetProperty("ok", out var ok) || ok.ValueKind != JsonValueKind.True) return false;
            if (!root.TryGetProperty("command", out var node)) return false;
            if (node.ValueKind == JsonValueKind.Null) return true;
            if (node.ValueKind != JsonValueKind.Object || !SessionParser.ExactFields(node, "id", "instanceId", "action")) return false;
            var id = Text(node, "id");
            var instance = Text(node, "instanceId");
            var action = Text(node, "action");
            if (!Uuid(id) || !Uuid(instance) || action is not ("start" or "stop" or "close")) return false;
            command = new WorkerControlCommand(Guid.ParseExact(id!.ToLowerInvariant(), "D"), Guid.ParseExact(instance!.ToLowerInvariant(), "D"), action);
            return true;
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or FormatException)
        {
            return false;
        }
    }

    private static string? Text(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static string MapStatus(int status, string? json)
    {
        if (json is not null && SessionParser.TryErrorCode(json, out var code)) return code;
        if (status == 404) return "not_found";
        if (status == 401) return "unauthorized";
        if (status == 503 || status >= 500) return "unavailable";
        return status is 400 or 403 or 429 ? "unavailable" : "invalid_response";
    }

    private static async Task<string?> ReadLimitedAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        var buffer = new byte[MaxResponseBytes + 1];
        var read = 0;
        while (read < buffer.Length)
        {
            var n = await stream.ReadAsync(buffer.AsMemory(read), cancellationToken);
            if (n == 0) break;
            read += n;
        }
        if (read > MaxResponseBytes) return null;
        try { return new UTF8Encoding(false, true).GetString(buffer, 0, read); }
        catch (DecoderFallbackException) { return null; }
    }

    public void Dispose()
    {
        _http.Dispose();
        if (_ownsHandler) _handler.Dispose();
    }
}
