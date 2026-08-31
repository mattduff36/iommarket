# Dealer stock archive

Local connector catalogue and archival snapshots. This does not write marketplace listings or upload to Cloudinary.

## Commands

```bash
npm run dealer-stock:probe -- --dealer athol-garage
npm run dealer-stock:archive -- --dealer athol-garage
npm run dealer-stock:archive -- --all
npm run dealer-stock:archive -- --all --no-images
npm run dealer-stock:archive -- --dealer bcc-cars --no-images
npm run dealer-stock:import -- --dealer athol-garage --expected-name "Athol Garage" --snapshot <runId>
npm run dealer-stock:inspect -- --zeros-and-partials
npm run dealer-stock:inspect -- --zeros-and-partials --snapshot <archiveRunId>
npm run dealer-stock:inspect -- --refresh-report --inspect-run <inspectRunId>
```

`npm run import:ocean-preview` remains the Ocean preview insert command.

Archive root: `DEALER_STOCK_ARCHIVE_DIR` or `private/dealer-stock-archive`.

`--apply` on `dealer-stock:import` is refused in this task. Dry-run requires `--dealer` and `--expected-name` to match the archive record exactly.
