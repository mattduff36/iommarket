# Accounts ledger: isolated iTrader preview

This mode tests Accounts data with iTrader's existing cost dashboard and controls. Production continues using its existing ledger and writers. Do not merge this work into `main` or change production configuration until the owner approves the deployed preview and a reconciled cutover.

## Deployment boundary

Configure these values on the iTrader **preview branch environment only**:

- `COST_LEDGER_ROLE=accounts-preview`
- `COSTS_ENABLED=true`
- `COST_ACCOUNTS_READ_TOKEN`: secret scoped to Accounts' `itrader` project; never print or commit it.
- `COST_ACCOUNTS_PREVIEW_DB_FINGERPRINT`: full lowercase 64-character SHA256 of the active database identity.
- `SUPABASE_DB_CA_CERT`: the verified public database CA certificate required by the existing database connector.

The guard additionally requires Vercel's `VERCEL_ENV=preview` and `VERCEL_PROJECT_ID=prj_TFAfJkG9P0osjQpsH2gaNrSPWbCr`. Database resolution matches the application: `POSTGRES_URL`, then `POSTGRES_URL_NON_POOLING`, then `DATABASE_URL`. `POSTGRES_PRISMA_URL` is not used. The fingerprint input is `[hostname, port, pathname, decodeURIComponent(username)].join('|')`; passwords and URL query parameters are excluded. The fingerprint must match both the configured full digest and the previously verified preview identity pinned in code. `COST_LEDGER_DATABASE_URL` is forbidden. There is no production or local-environment bypass.

Keep database values and tokens out of logs. Apply only the reviewed additive `20260929120000_accounts_preview_projection` migration to the verified preview database. It adds `ACCOUNTS_LEDGER` and `SUPPRESSED` enum values; it neither deletes nor replaces legacy records. Do not use `db push`, reset, or the older rollout instructions to configure this mode.

## Sources and refresh

Opening the cost page fetches the complete project-scoped snapshot from the fixed Accounts origin `https://accounts.mpdee.info`. The snapshot starts at `2026-08-13T23:00:00.000Z`, iTrader's historical ledger boundary. The separate `/api/costs/projects/itrader/baseline` response supplies reviewed non-Cursor legacy charges. Both responses must succeed and validate before the local projection commits.

The dashboard's **Last updated** card replaces provider refresh. Its time is the source update time, not the page-load time. Reloading the page retrieves Accounts again. This mode never invokes iTrader provider refresh, its live proxy writers, or cost-maintenance email delivery. Missing, held, or unconverted amounts are not manufactured as zero charges.

Changes append reversals and replacement entries; disappearing source IDs are reversed. Replaying an unchanged response adds no entries. Baseline, usage and manual test entries have distinct namespaces; the original preview ledger rows are retained and excluded. Policy/FX revision checksums control updates even when source timestamps do not change.

## Baseline limitations

The reviewed baseline contains **frozen client charges, not provider cash expenses**. Preserve signed GBP pence, credits, invoiceability and exact exclusive period ends; never apply markup again. It is a reviewed historical snapshot, not a live infrastructure connector. A later production cutover must reconcile the final legacy delta, including the £0.38/day membership allocation and any new credits or settlements. Future infrastructure appearing in the usage snapshot fails closed until its overlap with the baseline has been reviewed.

## Test workflows

Invoice requests freeze the selected signed pence in the preview database. Confirmation settles only those preview entries. Manual entries and categories remain local to this preview. These actions do not create Accounts invoices or alter either live ledger. Notifications are recorded as `SUPPRESSED` and no email is sent, including retries. The dashboard identifies this isolation explicitly.

Preview configuration deliberately fails closed if copied to production. Production integration requires a separate reviewed design/configuration change, a final reconciliation, and owner approval; merging code alone is not a cutover.

## Comparison views

The preview also reads `GET /api/costs/projects/itrader/comparison?from=2026-08-13T23:00:00.000Z`. That response is `mpdee-project-cost-comparison-v1`. It keeps usage value, provider cost, client charge and outstanding balance separate. iTrader copies those figures and does not apply the Cursor 60/110 rates again. Provisional comparison lines are not invoiceable. A missing or invalid comparison is shown as a coverage gap; it does not replace the snapshot, the baseline, or manufacture a zero balance.

Snapshot lines project as `PROVISIONAL` unless the line itself carries invoiceability. Held and unknown amounts still create no charge. Baseline rows keep their own invoiceability and exact exclusive period ends. A non-Cursor snapshot line is rejected while a baseline is present, unless the caller passes a reviewed infrastructure delta whose ids do not overlap the frozen baseline. Frozen client charges are never treated as provider expenses.

iTrader remains the only writer. The comparison policy is `mpdee-comparison-policy-v1`: included Cursor at 50%, on-demand at 100%, infrastructure at face value, and the fixed £0.38/day allocation disabled. Stored Accounts policies are not changed by this reader.

## Verification

Targeted tests cover deployment guards, snapshot validation, replay, disappearing/held lines, baseline credits and periods, signed request snapshots, rejected cross-namespace settlements, and the absence of automatic provider refresh. Existing action, email, dashboard and cron tests also pass. Run:

```text
npx vitest run __tests__/lib/cost-accounts-preview.test.ts __tests__/lib/cost-accounts-comparison.test.ts __tests__/lib/cost-accounts-preview-workflows.test.ts __tests__/components/admin-costs-dashboard.test.tsx __tests__/components/admin-costs-provider-refresh.test.tsx
npm run typecheck
npm run build
```

The local build attempt was blocked by Google Fonts download failures for Inter and Orbitron; TypeScript checks passed. A successful Vercel build and authenticated preview verification remain required release evidence. Real projection verification must compare original legacy/request/settlement counts before and after sync, compare category totals, and confirm a second identical fetch adds no entries. Use only the verified preview environment for that check.
