# Dealer website stock sync

The feature is deployed to preview at `https://itrader.dev`, with its additive migration applied to the preview database. Production remains disabled. Admin pages and the Friday cron only enqueue jobs; a separate worker must be running to scrape websites and apply approved changes.

Enabling a dealer binding does not mean sync is active. The dealers screen says so. If the worker process is absent, queued jobs stay queued.

## What the worker does

`npm run dealer-stock:worker -- --once` processes at most one leased job and exits.

`npm run dealer-stock:worker -- --watch` keeps leasing jobs until SIGINT or SIGTERM. It finishes the current job, then stops. This command does not install a service or a scheduler.

Both commands refuse to start unless:

- `DEALER_STOCK_SYNC_WORKER=1`
- `DEALER_STOCK_SYNC_TARGET=local`, `preview`, or (after acceptance) `production`

The shared environment guard checks the site origin, authentication project, deployment target and every configured database URL. Preview must use project `syneonzucehwlghqmfbg`; production must use `snlqivvogfqesxpbjiei`. Conflicting `DATABASE_URL`, `POSTGRES_URL` and `POSTGRES_URL_NON_POOLING` values are rejected. Local testing requires `DEALER_STOCK_SYNC_ISOLATED_LOCAL=1` and loopback connections.

Production defaults off: leave `DEALER_STOCK_SYNC_PRODUCTION_ENABLED` unset or `0` until preview acceptance. The Actions menu item stays visible and disabled with an explanatory tooltip. Server actions, cron and workers enforce the same flag. `DEALER_STOCK_SYNC_ENABLED=0` disables either environment. The disabled production detail page returns before querying the new tables.

The worker reuses the existing dealer stock pipeline for the bound registry key only. Shared orchestration uses site/platform-specific connectors. Approved apply jobs update price and mileage, create LIVE listings with owned images, a stable slug and normal expiry, or take down a listing absent twice. They do not call the production pack audit apply.

## Weekly queue

Vercel cron calls `GET /api/cron/dealer-stock-sync` at Friday 05:00 and 06:00 UTC. The route checks that the Europe/London clock is Friday at 06:00, then enqueues one scrape per enabled, verified, live dealer binding. The other hour is a no-op because each binding has one weekly key. The cron never approves or applies a plan.

The watch worker also checks this schedule, so preview does not depend on Vercel's production-only cron. Start it before Friday 06:00 UK time. If it is stopped for the entire 06:00-06:59 window, use an on-demand check. The user selected this machine for temporary preview testing; a permanent supervised host is still needed after acceptance.

Provide an explicitly reviewed environment file or exported variables; the worker never silently loads `.env.local`. Alongside the flags, supply the matching `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, database connection(s), `SUPABASE_DB_CA_CERT` and existing image-provider settings. Never copy production credentials into the preview worker.

On-demand scrapes are queued from the dealer row or from Sync all enabled dealers. Sync all ignores bindings that are not enabled. Preview, disabled, deleted, and non-dealer accounts are excluded when the job is queued and again when it runs.

## Review rules

A scrape that is empty, partial, failed, missing details, or pagination-uncertain is stored as a failure and does not increase absence counts. Reserved and POA vehicles stay in the inventory used for absence, including Franklins reserved cards, which are no longer treated as POA.

A managed listing is proposed for unpublish only after two distinct complete scrapes have missed it. Reappearance resets the count. Sold listings, manual take-downs, pending revisions, featured listings, and listings without a source binding are not unpublished. Dealer edits to price or mileage, and listings with no imported baseline, are conflicts. Title, description, photos, expiry, and paid feature flags are left in place.

New reports freeze source photo URLs. Only after approval does the existing upload pipeline import them. Validated owned receipts are attached in the apply transaction; remote dealer URLs are never attached directly. Failed apply uploads are queued for cleanup. No usable source photos means the vehicle remains blocked. ImageKit keeps its existing environment and activation gates.

New reports supersede older pending/approved reports. Partial sightings reset absence counts without increasing missing counts. Binding-row locks prevent concurrent jobs for one dealer; owner-token leases and heartbeats fence stale workers. Apply rechecks the report, dealer, approver, listing snapshot and cap inside a serializable transaction. Concurrent edits invalidate the report.

## Activation checklist

1. Preview migration `prisma/migrations/20261010140000_dealer_stock_sync` was applied on 10 October 2026; all five tables have row-level security. Production has not been migrated for this feature.
2. Deploy the application so the admin page and cron route exist.
3. Run the worker with the opt-in variables above, as a supervised process you control. Do not assume the Vercel web app runs it.
4. Bind a live dealer to a registry source, queue a scrape, and approve the frozen plan only after the review looks right.
5. Verify rendered preview listings, owned photos, repeat-run behaviour, partial failures and stale reports. Stop the temporary worker after testing.
6. Only after preview acceptance, arrange the permanent worker and approved staging-to-main release, production migration and explicit production flag activation.

## Local verification

Real isolated PostgreSQL checks covered overlapping lease claims, repeated price updates, approved new LIVE listings with mocked image-provider receipts, two-absence removal after approval, partial reappearance, stale plans and refusal of unleased jobs.

Hosted preview checks returned Franklin 8, Swift 39, Manx Car Warehouse 13, Mike's 32 and Ocean 151 vehicles. Franklin's reviewed plan created seven LIVE preview listings with 53 owned ImageKit photos under the staging namespace; one vehicle remained blocked for missing photos. The Hyundai gallery was verified in the browser. Other dealer reports await review; first checks of existing stock establish baselines. A temporary source failure was correctly reported without modifying listings.

The hosted upload check exposed a Prisma adapter incompatibility with the `void` result of `pg_advisory_xact_lock`; the importer now casts that result to text without changing locking behaviour. A diagnostic upload was queued for cleanup.

Vercel environment exports omit protected ImageKit keys. The temporary local worker reads the existing verified account keys from `D:/Websites/imagekit-credentials/itrader.env`; the owner also requested a copy in the ignored `.env.local`. Neither file belongs in Git. Worker database configuration still comes from the explicitly verified preview environment, not `.env.local`.
