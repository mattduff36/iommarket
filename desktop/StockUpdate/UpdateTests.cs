using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace StockUpdate;

public static class UpdateTests
{
    private static void Assert(bool value) { if (!value) throw new InvalidOperationException(); }
    private static void Reject(Action action)
    {
        try { action(); } catch (Exception) { return; }
        throw new InvalidOperationException("Accepted invalid update");
    }
    public static void Manifest()
    {
        using var key = RSA.Create(2048);
        var pub = key.ExportSubjectPublicKeyInfoPem();
        string Envelope(string channel = "preview", string version = "1.1.6", string? objectKey = null, long size = 3)
        {
            var fileName = $"iTrader-Stock-Update-{version}.exe";
            var payload = JsonSerializer.SerializeToUtf8Bytes(new { version, channel, objectKey = objectKey ?? $"{channel}/{version}/{fileName}", fileName, size, sha256 = new string('a', 64) });
            return JsonSerializer.Serialize(new { payload = Convert.ToBase64String(payload), signature = Convert.ToBase64String(key.SignData(payload, HashAlgorithmName.SHA256, RSASignaturePadding.Pss)) });
        }
        var valid = Envelope();
        var manifest = UpdateManifest.Verify(valid, pub);
        Assert(manifest.IsNewerThan("1.1.5") && !manifest.IsNewerThan("1.1.6") && !manifest.IsNewerThan("1.1.7"));
        Reject(() => UpdateManifest.Verify(Envelope("production"), pub));
        var production = UpdateManifest.Verify(Envelope("production"), pub, AppEnvironment.Production);
        Assert(production.DownloadUri("https://snlqivvogfqesxpbjiei.supabase.co/storage/v1/object/sign/stock-update-releases/" + production.ObjectKey + "?token=test").Host == "snlqivvogfqesxpbjiei.supabase.co");
        Reject(() => production.DownloadUri(StorageTestUrl(production)));
        Reject(() => UpdateManifest.Verify(valid, pub, AppEnvironment.Production));
        Reject(() => UpdateManifest.Verify(Envelope(version: "1.1.6-beta"), pub));
        Reject(() => UpdateManifest.Verify(Envelope(objectKey: "../other.exe"), pub));
        Reject(() => UpdateManifest.Verify(Envelope(size: UpdateManifest.MaximumSize + 1), pub));
        using var other = RSA.Create(2048);
        Reject(() => UpdateManifest.Verify(valid, other.ExportSubjectPublicKeyInfoPem()));
        var tampered = JsonSerializer.Deserialize<Dictionary<string, string>>(valid)!;
        var payloadBytes = Convert.FromBase64String(tampered["payload"]);
        payloadBytes[10] ^= 1;
        tampered["payload"] = Convert.ToBase64String(payloadBytes);
        Reject(() => UpdateManifest.Verify(JsonSerializer.Serialize(tampered), pub));
        var url = $"{UpdateManifest.StorageOrigin}/storage/v1/object/sign/stock-update-releases/{manifest.ObjectKey}?token=test";
        Assert(manifest.DownloadUri(url).Host == "syneonzucehwlghqmfbg.supabase.co");
        foreach (var invalid in new[] { url.Replace("https:", "http:"), url.Replace("syneonzucehwlghqmfbg", "other"), url.Replace("?token", "#token"), url.Replace("/preview/", "/production/"), url.Replace("https://", "https://user@") }) Reject(() => manifest.DownloadUri(invalid));
        Assert(UpdateClient.PublicKey().Contains("BEGIN PUBLIC KEY"));
    }

    private static string StorageTestUrl(UpdateManifest manifest) => UpdateManifest.StorageOrigin + "/storage/v1/object/sign/stock-update-releases/" + manifest.ObjectKey + "?token=test";

    public static void SiteSwitch()
    {
        var site = new SiteSelection();
        Assert(site.Environment == AppEnvironment.Preview);
        Assert(!site.TrySwitch(false, false, () => false) && site.Environment == AppEnvironment.Preview);
        Assert(!site.TrySwitch(true, false, () => throw new Exception()));
        Assert(!site.TrySwitch(false, true, () => throw new Exception()));
        Assert(site.TrySwitch(false, false, () => true) && site.Environment == AppEnvironment.Production);
        Assert(new SiteSelection().Environment == AppEnvironment.Preview);
        Assert(site.TrySwitch(false, false, () => throw new Exception()) && site.Environment == AppEnvironment.Preview);
    }

    public static void InstallArguments()
    {
        var path = Path.Combine(Path.GetTempPath(), "Stock Update test");
        var start = UpdateInstaller.StartInfo("verified.exe", path);
        Assert(start.UseShellExecute && start.FileName == "verified.exe");
        Assert(start.ArgumentList.Contains("/SILENT") && !start.ArgumentList.Contains("/VERYSILENT"));
        Assert(!start.ArgumentList.Contains("/SUPPRESSMSGBOXES"));
        Assert(start.ArgumentList.Contains("/NORESTART") && start.ArgumentList.Contains("/UPDATEAPP=1"));
        Assert(start.ArgumentList.Contains("/DIR=" + Path.GetFullPath(path)));
        Assert(!start.ArgumentList.Any(value => value.StartsWith("/TASKS=")));
    }

    public static void Download()
    {
        var bytes = Encoding.UTF8.GetBytes("verified installer fixture");
        var manifest = new UpdateManifest("1.1.6", "preview/1.1.6/iTrader-Stock-Update-1.1.6.exe", "iTrader-Stock-Update-1.1.6.exe", bytes.Length, Convert.ToHexStringLower(SHA256.HashData(bytes)));
        var url = $"{UpdateManifest.StorageOrigin}/storage/v1/object/sign/stock-update-releases/{manifest.ObjectKey}?token=test";
        using var client = new HttpClient(new Handler(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) }));
        var path = UpdateDownload.SaveAsync(client, manifest, url, CancellationToken.None).GetAwaiter().GetResult();
        Assert(File.ReadAllBytes(path).SequenceEqual(bytes));
        Directory.Delete(Path.GetDirectoryName(path)!, true);
        Reject(() => UpdateDownload.SaveAsync(client, manifest with { Sha256 = new string('0', 64) }, url, CancellationToken.None).GetAwaiter().GetResult());
        Reject(() => UpdateDownload.SaveAsync(client, manifest with { Size = bytes.Length + 1 }, url, CancellationToken.None).GetAwaiter().GetResult());
        Reject(() => UpdateDownload.SaveAsync(client, manifest with { Size = bytes.Length - 1 }, url, CancellationToken.None).GetAwaiter().GetResult());
        using var redirect = new HttpClient(new Handler(_ => new HttpResponseMessage(HttpStatusCode.Redirect) { Headers = { Location = new Uri("https://example.com") } }));
        Reject(() => UpdateDownload.SaveAsync(redirect, manifest, url, CancellationToken.None).GetAwaiter().GetResult());
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        Reject(() => UpdateDownload.SaveAsync(client, manifest, url, cancelled.Token).GetAwaiter().GetResult());
    }
    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> next) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Assert(request.Headers.Authorization is null);
            return Task.FromResult(next(request));
        }
    }
}
