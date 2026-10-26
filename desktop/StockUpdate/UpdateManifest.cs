using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace StockUpdate;

public sealed record UpdateManifest(string Version, string ObjectKey, string FileName, long Size, string Sha256, AppEnvironment Environment = AppEnvironment.Preview)
{
    public const long MaximumSize = 262144000;
    public const string StorageOrigin = "https://syneonzucehwlghqmfbg.supabase.co";

    public static UpdateManifest Verify(string envelope, string publicKey, AppEnvironment environment = AppEnvironment.Preview)
    {
        if (envelope.Length > 16384) throw new InvalidDataException();
        using var wrapper = JsonDocument.Parse(envelope);
        var payload = Convert.FromBase64String(wrapper.RootElement.GetProperty("payload").GetString()!);
        var signature = Convert.FromBase64String(wrapper.RootElement.GetProperty("signature").GetString()!);
        using var rsa = RSA.Create();
        rsa.ImportFromPem(publicKey);
        if (!rsa.VerifyData(payload, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pss)) throw new InvalidDataException();
        using var document = JsonDocument.Parse(new UTF8Encoding(false, true).GetString(payload));
        var root = document.RootElement;
        if (root.EnumerateObject().Count() != 6 || root.GetProperty("channel").GetString() != Targets.WireName(environment)) throw new InvalidDataException();
        var version = root.GetProperty("version").GetString()!;
        if (!Regex.IsMatch(version, @"^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$")) throw new InvalidDataException();
        var fileName = root.GetProperty("fileName").GetString()!;
        var objectKey = root.GetProperty("objectKey").GetString()!;
        var size = root.GetProperty("size").GetInt64();
        var sha256 = root.GetProperty("sha256").GetString()!;
        if (fileName != $"iTrader-Stock-Update-{version}.exe" || objectKey != $"{Targets.WireName(environment)}/{version}/{fileName}" || size <= 0 || size > MaximumSize || !Regex.IsMatch(sha256, "^[a-f0-9]{64}$")) throw new InvalidDataException();
        return new(version, objectKey, fileName, size, sha256, environment);
    }

    public bool IsNewerThan(string current) => System.Version.Parse(Version) > System.Version.Parse(current);

    public Uri DownloadUri(string raw)
    {
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.Host != (Environment == AppEnvironment.Preview ? "syneonzucehwlghqmfbg.supabase.co" : "snlqivvogfqesxpbjiei.supabase.co") || uri.Port != 443 || uri.UserInfo.Length != 0 || uri.Fragment.Length != 0 || uri.AbsolutePath != $"/storage/v1/object/sign/stock-update-releases/{ObjectKey}" || uri.Query.Length == 0) throw new InvalidDataException();
        return uri;
    }
}
