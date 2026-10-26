using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace StockUpdate;

public sealed class SessionStore
{
    private readonly string _root;

    public SessionStore(string? root = null)
    {
        _root = root ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "iTrader", "StockUpdate", "sessions");
    }

    public string PathFor(AppEnvironment environment) =>
        Path.Combine(_root, Targets.WireName(environment) + ".bin");

    public void Save(WorkerSession session)
    {
        var persisted = new Persisted(session.AccessToken, session.DeviceId, session.ExpiresAt, Targets.WireName(session.Environment), session.Account);
        var json = JsonSerializer.Serialize(persisted, JsonOpts.Camel);
        var protectedBytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(json), null, DataProtectionScope.CurrentUser);
        Directory.CreateDirectory(_root);
        var target = PathFor(session.Environment);
        var temp = target + ".tmp";
        File.WriteAllBytes(temp, protectedBytes);
        File.Move(temp, target, overwrite: true);
    }

    public WorkerSession? TryLoad(AppEnvironment environment)
    {
        var target = PathFor(environment);
        if (!File.Exists(target)) return null;
        try
        {
            if (new FileInfo(target).Length > 65536) { Delete(target); return null; }
            var plain = ProtectedData.Unprotect(File.ReadAllBytes(target), null, DataProtectionScope.CurrentUser);
            var json = new UTF8Encoding(false, true).GetString(plain);
            if (!SessionParser.TryParse(json, environment, out var session))
            {
                Delete(target);
                return null;
            }
            return session;
        }
        catch (Exception ex) when (ex is CryptographicException or JsonException or IOException or UnauthorizedAccessException or FormatException or DecoderFallbackException)
        {
            Delete(target);
            return null;
        }
    }

    public void Clear(AppEnvironment environment)
    {
        Delete(PathFor(environment));
    }

    private static void Delete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private sealed record Persisted(string AccessToken, string DeviceId, DateTimeOffset ExpiresAt, string Environment, AccountInfo Account);
}
