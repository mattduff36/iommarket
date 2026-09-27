# iTrader ledger

The canonical ledger stays in the production Postgres database. Live and preview admin pages read it through `/api/internal/cost-ledger`. Preview does not open that database directly. A deployment is the writer only when `COST_LEDGER_ROLE=canonical` and, on Vercel, `VERCEL_PROJECT_ID` matches `COST_CANONICAL_VERCEL_PROJECT_ID`. `VERCEL_ENV` is not that signal, because a staging site can be another project's production deployment.

Cursor client charges are 60% of included nominal value plus 110% of reported on-demand value. Infrastructure, database, and manual costs are stored at the face value after currency conversion. The next provider refresh replaces existing infrastructure lines at that face value. iTrader also records a daily £0.38 Vercel Pro membership share in Website hosting. Included and on-demand funding come from `USAGE_EVENT_KIND_INCLUDED_IN_ULTRA` and `USAGE_EVENT_KIND_USAGE_BASED`. `isChargeable` and the old `chargedMicroCents` field do not decide funding. Account-wide allowance is stored separately and a $400 estimate never flips a request to on-demand.

Vercel hosting can include every project id in `COST_VERCEL_PROJECT_ID`, `COST_VERCEL_PREVIEW_PROJECT_ID` and `COST_VERCEL_PROJECT_IDS`. A marketplace database resource is counted once. Untagged FOCUS rows stay on the existing shared-allocation rule until `COST_FOCUS_UNTAGGED_POLICY=unresolved` is set, so this change does not reprice history by itself. Supabase lines missing from FOCUS are entered once as Database manual costs, using the invoice line id as the reference.

Local collection writes the sanitized account event stream and upload outbox to SQLite outside the repository, while uploading only iTrader-attributed events. The provider response does not currently expose a verified account billing-cycle/pool observation, so allowance updates remain a manual import until those fields are available. The former tracked rolling usage file has been removed. Collection failure does not block commit or `/fap`.

The migration `prisma/migrations/20260926190000_cost_cursor_client_policy` is prepared and not applied. `npm run cost:cursor-reconcile` prints a dry-run reprice report and does not write. Ingestion refuses a day that still has an unreversed `cursor:subscription:` line, preventing old subscription allocation and new request charging from being billed together.

## Future MPDEE expansion

These boundaries are for a later accounts site. They are not that site.

- One provider account has one usage stream. Deduplicate by account and event identity, not by Git branch or project.
- Keep `providerAccountRef`, `projectId` and an optional future `clientId`. Environment and branch are dimensions, not identities.
- Source events stay immutable. Project allocation is a separate decision and must not exceed 100%.
- The 60/110 policy belongs to iTrader only. Other projects can use a different policy later.
- Collection and charge calculation do not depend on iTrader pages. `COST_LEDGER_ORIGIN` chooses the destination.
- Until the accounts service exists, only iTrader event detail and an owner-only allowance summary are uploaded here.
- Move the writer once: stop writes, export the final delta, import it, then repoint collectors. Do not run two writers.

## Rollout

1. Review this note and the dry-run reprice output.
2. Set `COST_LEDGER_ROLE=canonical` and `COST_CANONICAL_VERCEL_PROJECT_ID` on the live Vercel project only.
3. Keep separate `COST_LEDGER_READ_SECRET`, `COST_LEDGER_INGEST_SECRET` and `COST_LEDGER_REQUEST_SECRET` values. Put the read and request secrets on preview with `COST_LEDGER_ORIGIN` pointing at live. Do not put `COST_LEDGER_DATABASE_URL`, the ingest secret, or the billing token on preview.
4. Set `COSTS_ENABLED=true` for the preview branch and redeploy that branch after changing its environment.
5. Apply the prepared migration with `npm run db:migrate` when you intend to change the database. Do not reset it.
6. Run one bounded infrastructure sync and one collector upload. Compare ledger revision and totals on both admin sites.
7. Reprice an uninvoiced Cursor day only after request-level evidence exists for that day. Leave invoiced settlements unchanged.
