using System.Text.Json;
namespace StockUpdate;
public sealed record AppPreferences(bool DebugLayout)
{
    private static string FilePath => Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData), "iTrader", "StockUpdate", "preferences.json");
    public static AppPreferences Load()
    {
        try {
            if (new FileInfo(FilePath).Length > 1024) return new(false);
            var value = JsonSerializer.Deserialize<AppPreferences>(File.ReadAllText(FilePath));
            return value ?? new(false);
        } catch { return new(false); }
    }
    public void Save()
    {
        try {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            File.WriteAllText(FilePath + ".tmp", JsonSerializer.Serialize(this));
            File.Move(FilePath + ".tmp", FilePath, overwrite: true);
        } catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }
}
