using System.Net;
using System.Security.Cryptography;

namespace StockUpdate;

public static class UpdateDownload
{
    public static HttpClient CreateClient() => new(new SocketsHttpHandler
    {
        AllowAutoRedirect = false, UseCookies = false, ConnectTimeout = TimeSpan.FromSeconds(15)
    }) { Timeout = TimeSpan.FromMinutes(10) };

    public static async Task<string> SaveAsync(HttpClient client, UpdateManifest manifest, string url, CancellationToken token, IProgress<int>? progress = null)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromMinutes(10));
        token = deadline.Token;
        var uri = manifest.DownloadUri(url);
        var directory = Path.Combine(Path.GetTempPath(), "iTraderUpdate-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, manifest.FileName);
        try
        {
            using var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, token);
            if (response.StatusCode != HttpStatusCode.OK || (response.Content.Headers.ContentLength is long declared && declared != manifest.Size)) throw new InvalidDataException();
            await using var input = await response.Content.ReadAsStreamAsync(token);
            await using var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, true);
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            var buffer = new byte[81920];
            long total = 0;
            for (;;)
            {
                var read = await input.ReadAsync(buffer, token);
                if (read == 0) break;
                total += read;
                if (total > manifest.Size) throw new InvalidDataException();
                hash.AppendData(buffer, 0, read);
                await output.WriteAsync(buffer.AsMemory(0, read), token);
                progress?.Report((int)(100 * total / manifest.Size));
            }
            if (total != manifest.Size || Convert.ToHexStringLower(hash.GetHashAndReset()) != manifest.Sha256) throw new InvalidDataException();
            return path;
        }
        catch
        {
            try { Directory.Delete(directory, true); } catch (IOException) { }
            throw;
        }
    }
}
