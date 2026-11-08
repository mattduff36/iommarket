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

New reports supersede older pending/approved reports. Partial sightings reset absence counts without increasing missing counts. Binding-row locks prevent concurrent jobs for one dealer; owner-token leases and heartbeats fence stale workers. Apply rechecks the report, dealer, approver, listing snapshot and cap inside a serialisable transaction. Concurrent edits invalidate the report.

### Clearing blocked items

Clear blocked removes only the selected review rows. The same serializable transaction saves versioned, server-generated dismissal evidence in the rejection audit. Later complete scrapes read rejection audits for the exact dealer and binding, independently of result history, report status or recent-result limits. Only unchanged blocked/conflict rows with stable, unambiguous identities are omitted, before the report fingerprint is computed. Identity patches, absence counts, inventory counts, outstanding selections and draft handoffs are preserved. Creates, updates, missing-once observations and proposed removals are never suppressed.

Comparison includes vehicle facts, availability, photos, block reason/section and relevant mapping, baseline and linked-listing protections. Duplicate-managed conflicts compare every matching listing, not the first match. Live evidence freezes a per-vehicle source signature, including facts not displayed by the editor; corrections preserve it. Fallback requires saved per-item description, attributes and review facts, never the whole-document source hash. Older reviewed-seed evidence without those facts or a frozen per-vehicle signature remains visible conservatively; clearing it cannot establish facts that were never captured. Known expiring URL signatures and scrape/capture bookkeeping do not count as content changes; image identity, transformations and version parameters do. Source or local-context changes bring the item back.

Legacy rejection audits lack safe local-context evidence and intentionally leave items visible once rather than guessing. Missing, malformed, duplicate or insufficient evidence also leaves items visible, and an insufficient newer rejection cannot reuse an older dismissal. Audit lookup errors fail the scrape explicitly; no permissions are widened. The supported installed desktop path uses the server database client. Legacy direct-database CLI audit-read permission must be verified separately before using that path.

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


## Admin results and dealer selection (26 October 2026)

Production stock sync is now enabled for the admin-reviewed desktop workflow described in `stock-update-desktop.md`; the original activation checklist above records the earlier preview rollout.

The stock-reviews picker uses the real dealer account's stored tier. Disabled accounts and Starter accounts are unavailable. A missing or expired billing entitlement does not exclude an enabled Pro account from admin-managed scrapes. Preview-only placeholder profiles remain outside the real-dealer picker. Website binding setup is separate from account eligibility; a verified registry binding is still required before a job can run.

Applied reports and genuine No change reviews (including empty reviews and superseded No change snapshots) are automatically shown under Archived. No change requires a valid plan containing only unchanged or sold-excluded rows, without unresolved selections or draft ownership. Failed checks, approved recovery, missing-once observations, proposed removals and unresolved blocks/conflicts are not automatically archived as No change. Rejected and superseded actionable snapshots retain their existing history behavior. Restoring a deleted No change review returns it to Archived; its Archived card has no Restore button. Archive, Delete and Restore are per-result admin actions saved as RESULT_ARCHIVED, RESULT_DELETED and RESULT_RESTORED events in DealerStockSyncAudit. They affect results-history visibility across computers, not report status, worker job state or listings. Deleted results can be restored from the Deleted view. The old browser-only clear list is no longer used.

Active jobs, approved work and actionable reviews awaiting a decision cannot be archived or deleted. Completed job cards are suppressed when their corresponding report is shown, including rejected reports, so one scrape is represented once. Status badges contain short labels; explanatory text is outside the badge.

## Recovering an interrupted apply

An approved report keeps its processing state and recovery actions even when the failed job's history notification is archived or deleted. Recovery looks up retained attempts directly, independently of the recent-results limit.

Use **Retry approved changes** after a failed or cancelled APPLY attempt. The server rechecks admin access, the saved approval, the current dealer/source and stock fingerprint under the existing binding/dealer/listing locks. It queues one new attempt with a key tied to the failed attempt. The new payload contains no old staged-photo receipts; the original attempt stays in history. Manual recovery does not require weekly scheduling to be enabled.

Queued or leased work for the same dealer blocks another recovery attempt. A changed or incompatible approval requires **Run a fresh check**, which uses the normal scrape queue and requires review and approval of its new results. Neither recovery action directly changes listings, resets a failed job, changes the frozen approval, or applies the unapproved remainder. Normal successful apply still restores that remainder for review.

From an individual dealer page, **Open stock recovery** opens the saved report in Stock Reviews, where the desktop app launch and live status polling are available. Recovery never queues an unattended job from that standalone page.
