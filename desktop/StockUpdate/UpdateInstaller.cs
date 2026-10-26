using System.Diagnostics;
namespace StockUpdate;
public static class UpdateInstaller
{
    public static ProcessStartInfo StartInfo(string installer, string directory)
    {
        var info = new ProcessStartInfo(installer) { UseShellExecute = true };
        foreach (var argument in new[] { "/SP-", "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/NOCLOSEAPPLICATIONS", "/UPDATEAPP=1", "/DIR=" + Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar) })
            info.ArgumentList.Add(argument);
        return info;
    }
}
