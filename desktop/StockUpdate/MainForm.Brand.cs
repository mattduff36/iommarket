namespace StockUpdate;

public sealed partial class MainForm
{
    private static Control CreateBrandPanel()
    {
        using var stream = typeof(MainForm).Assembly.GetManifestResourceStream("StockUpdate.logo.png")
            ?? throw new InvalidOperationException("The embedded iTrader logo is missing.");
        using var source = Image.FromStream(stream);
        var logo = new PictureBox
        {
            Image = new Bitmap(source),
            BackColor = Color.Black,
            SizeMode = PictureBoxSizeMode.Zoom,
            Dock = DockStyle.Fill,
            Margin = new Padding(0, 35, 0, 8),
            AccessibleName = "iTrader logo"
        };
        logo.Disposed += (_, _) => logo.Image?.Dispose();
        var panel = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 2,
            Padding = new Padding(48, 12, 48, 38)
        };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        panel.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        panel.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        panel.Controls.Add(logo, 0, 0);
        panel.Controls.Add(new Label
        {
            Text = "Dealer Stock Update Tool",
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font("Segoe UI", 14f),
            AutoSize = false
        }, 0, 1);
        return panel;
    }
}
