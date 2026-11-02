using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace StockUpdate;

public enum AppEnvironment
{
    Preview,
    Production
}

public static class Targets
{
    public const string ClientVersion = "1.1.12";
    public const string PreviewHost = "itrader.dev";
    public const string ProductionHost = "itrader.im";

    public static string Host(AppEnvironment environment) =>
        environment == AppEnvironment.Preview ? PreviewHost : ProductionHost;

    public static string Origin(AppEnvironment environment) => "https://" + Host(environment);

    public static string Api(AppEnvironment environment) => Origin(environment) + "/api/stock-worker";

    public static string WireName(AppEnvironment environment) =>
        environment == AppEnvironment.Preview ? "preview" : "production";

    public static bool TryParse(string? value, out AppEnvironment environment)
    {
        if (string.Equals(value, "preview", StringComparison.Ordinal))
        {
            environment = AppEnvironment.Preview;
            return true;
        }
        if (string.Equals(value, "production", StringComparison.Ordinal))
        {
            environment = AppEnvironment.Production;
            return true;
        }
        environment = default;
        return false;
    }

    public static bool TryFixedHttps(AppEnvironment environment, string path, string? query, out Uri uri)
    {
        uri = new Uri(Origin(environment), UriKind.Absolute);
        if (path.Length == 0 || path[0] != '/' || path.Contains("://", StringComparison.Ordinal) || path.Contains('\\'))
            return false;
        var builder = new UriBuilder(uri) { Path = path, Query = query ?? "" };
        uri = builder.Uri;
        return uri.Scheme == "https" && string.Equals(uri.Host, Host(environment), StringComparison.Ordinal) && uri.Port == 443;
    }
}

public sealed record AccountInfo(string Id, string Name, string Email);

public sealed record WorkerSession(
    string AccessToken,
    string DeviceId,
    DateTimeOffset ExpiresAt,
    AppEnvironment Environment,
    AccountInfo Account);

public static class TokenShapes
{
    public static bool Base64Url(string? value, int length)
    {
        if (value is null || value.Length != length) return false;
        foreach (var ch in value)
        {
            if (ch is (>= 'A' and <= 'Z') or (>= 'a' and <= 'z') or (>= '0' and <= '9') or '-' or '_') continue;
            return false;
        }
        return true;
    }

    public static bool UserCode(string? value)
    {
        if (value is null || value.Length != 8) return false;
        foreach (var ch in value)
            if (ch is not ((>= 'A' and <= 'Z') or (>= '0' and <= '9'))) return false;
        return true;
    }

    public static bool DeviceId(string? value) =>
        value is not null && value.StartsWith("dev_", StringComparison.Ordinal) && Base64Url(value.AsSpan(4).ToString(), 22);
}

public static class Pkce
{
    public static (string Verifier, string Challenge) Create()
    {
        var verifier = Base64Url(RandomNumberGenerator.GetBytes(32));
        var challenge = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        return (verifier, challenge);
    }

    public static string ChallengeFor(string verifier) =>
        Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));

    public static string Base64Url(byte[] data) =>
        Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

public static class JsonOpts
{
    public static readonly JsonSerializerOptions Camel = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        MaxDepth = 8
    };
}

public static class SafeText
{
    public static string DeviceName()
    {
        var raw = Environment.MachineName;
        var chars = raw.Where(ch => char.IsAsciiLetterOrDigit(ch) || ch is '-' or ' ').Take(40).ToArray();
        var name = new string(chars).Trim();
        return name.Length == 0 ? "StockUpdate" : name;
    }

    public static string Email(string email)
    {
        var at = email.IndexOf('@');
        if (at <= 0 || at == email.Length - 1) return "redacted";
        return email[0] + "***" + email[at..];
    }

    public static string MapError(string code) => code switch
    {
        "invalid_request" => "The request was rejected.",
        "invalid_grant" => "The sign-in code is no longer valid. Start sign-in again.",
        "unauthorized" => "Sign-in is required.",
        "forbidden" => "This account is not allowed to use Stock Update.",
        "rate_limited" => "The server asked the app to wait. Try again shortly.",
        "unavailable" => "The Stock Update service is unavailable.",
        "redirect_rejected" => "The server returned a redirect. The app did not follow it.",
        "invalid_response" => "The server response was not usable.",
        "cancelled" => "The operation was cancelled.",
        "expired" => "Sign-in expired. Start sign-in again.",
        "missing_payload" => "Installation is incomplete. The bundled Node runtime or worker files are missing. Reinstall Stock Update. This app will not use another Node, Git, or npm.",
        "already_running" => "A worker is already running.",
        "not_signed_in" => "Sign in before starting the worker.",
        _ => "The operation failed."
    };
}

public static class SessionParser
{
    public static bool TryParse(string json, AppEnvironment expected, out WorkerSession session)
    {
        session = null!;
        try
        {
            using var doc = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 8, CommentHandling = JsonCommentHandling.Disallow });
            var root = doc.RootElement;
            if (!ExactFields(root, "accessToken", "deviceId", "expiresAt", "environment", "account")) return false;
            if (!TokenShapes.Base64Url(Read(root, "accessToken"), 43)) return false;
            if (!TokenShapes.DeviceId(Read(root, "deviceId"))) return false;
            if (!Targets.TryParse(Read(root, "environment"), out var environment) || environment != expected) return false;
            if (!root.TryGetProperty("expiresAt", out var exp) || exp.ValueKind != JsonValueKind.String) return false;
            if (!DateTimeOffset.TryParse(exp.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var expires)) return false;
            if (expires.UtcDateTime <= DateTime.UtcNow) return false;
            if (!root.TryGetProperty("account", out var account) || !ExactFields(account, "id", "name", "email")) return false;
            var id = Read(account, "id");
            var name = Read(account, "name");
            var email = Read(account, "email");
            if (id is null || name is null || email is null || id.Length is 0 or > 80 || name.Length is 0 or > 120 || email.Length is 0 or > 160)
                return false;
            session = new WorkerSession(Read(root, "accessToken")!, Read(root, "deviceId")!, expires, environment, new AccountInfo(id, name, email));
            return true;
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException)
        {
            return false;
        }
    }

    public static bool TryErrorCode(string json, out string code)
    {
        code = "";
        try
        {
            using var doc = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 4 });
            if (!ExactFields(doc.RootElement, "error") || !doc.RootElement.TryGetProperty("error", out var err) || err.ValueKind != JsonValueKind.String) return false;
            var value = err.GetString();
            if (value is "invalid_request" or "invalid_grant" or "unauthorized" or "forbidden" or "rate_limited" or "unavailable")
            {
                code = value;
                return true;
            }
            return false;
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException)
        {
            return false;
        }
    }

    public static bool ExactFields(JsonElement element, params string[] fields)
    {
        if (element.ValueKind != JsonValueKind.Object) return false;
        var remaining = new HashSet<string>(fields, StringComparer.Ordinal);
        foreach (var property in element.EnumerateObject())
            if (!remaining.Remove(property.Name)) return false;
        return remaining.Count == 0;
    }

    private static string? Read(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
