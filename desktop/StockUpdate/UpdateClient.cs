using System.Net;
using System.Net.Http.Headers;
using System.Reflection;
using System.Text;
using System.Text.Json;

namespace StockUpdate;

public sealed record AvailableUpdate(UpdateManifest Manifest, string DownloadUrl);

public static class UpdateClient
{
    public static string PublicKey()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("StockUpdate.update-public-key.pem") ?? throw new InvalidDataException();
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    public static async Task<AvailableUpdate?> CheckAsync(WorkerSession session, CancellationToken token)
    {
        if (session.Environment != AppEnvironment.Preview) return null;
        using var client = UpdateDownload.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(20);
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://itrader.dev/api/stock-worker/update");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
        if (response.StatusCode != HttpStatusCode.OK) throw new InvalidDataException();
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(token);
        limit.CancelAfter(TimeSpan.FromSeconds(20));
        await using var input = await response.Content.ReadAsStreamAsync(limit.Token);
        using var bytes = new MemoryStream();
        var buffer = new byte[4096];
        for (;;)
        {
            var count = await input.ReadAsync(buffer, limit.Token);
            if (count == 0) break;
            if (bytes.Length + count > 16384) throw new InvalidDataException();
            bytes.Write(buffer, 0, count);
        }
        var json = new UTF8Encoding(false, true).GetString(bytes.ToArray());
        var manifest = UpdateManifest.Verify(json, PublicKey());
        if (!manifest.IsNewerThan(Targets.ClientVersion)) return null;
        using var document = JsonDocument.Parse(json);
        var url = document.RootElement.GetProperty("downloadUrl").GetString()!;
        manifest.DownloadUri(url);
        return new(manifest, url);
    }
}
