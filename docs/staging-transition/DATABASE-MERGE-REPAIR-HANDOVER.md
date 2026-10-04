# Database merge repair handover

Checkpoint after the isolated PostgreSQL repair and before any staging deploy. This is the production-to-development database merge, not the staging-to-main code release.

## Current git

- Branch: `staging`
- Base at the start of the repair commit: `599c4bbcf20f04c682faf9e876e34b03186be268` (`merge: sync production release back into staging`), matching `origin/staging` when last checked
- `5a040d52a4f6e01a9c4c3c7370da2f80be19a661` is an ancestor. That range does not change `lib/database-sync/`
- Unrelated ImageKit and admin-profile edits were present in the working tree and must stay uncommitted
- No reset, force-push, or production promotion

## Production failure

Deployment `dpl_3PggTP8xA5jLjFcr3zTfjwFA7uyW` (commit `5a040d5`) logged only `Database sync prepare stage failed. { stage: 'source snapshot' }`. The browser showed `Plan preparation failed during source snapshot. No development data was changed.`

That text is the generic wrapper. The old `prepareFailure()` discarded the exception. The failure was not a `DatabaseSyncError`. The connection and plan-storage stages had already succeeded.

The original exception is still unknown. Do not treat permissions, schema mismatch, timeout, or the codec as that diagnosis.

An earlier deployment, `dpl_7NiydZtqYLpysJ94EkAMnkSaXpLK` (`fe93ff1`), failed at preview checks. That matches the uncast `"char" || text` fingerprint expression, which `5a040d5` casts with `f.contype::text`.

## Why the old tests missed it

- Worker tests mock `pg`. Their prepare cases use Reset, which never opens the production snapshot.
- The fingerprint regression asserted SQL text, including `f.contype::text`, and did not execute it.
- `validateSourceClient()` existed but was not called inside the snapshot transaction.
- Missing relations were treated as tables with no columns, so the copy looked empty.
- Merge summaries stored captured source rows in `insert` and left update, preserve, and skip at zero.

## Access blocker

`DATABASE_SYNC_SOURCE_READONLY_URL` is not in local env files. The Vercel env read for project `prj_TFAfJkG9P0osjQpsH2gaNrSPWbCr` returned the variable as sensitive and did not decrypt it. No preview or production database was used as a test target.

## What the isolated database demonstrated

PostgreSQL 18 binaries already installed at `C:\Program Files\PostgreSQL\18\bin`. The test starts its own cluster on `127.0.0.1:55434` with `sync_source`, `sync_dest`, and login role `itrader_staging_reader` (`default_transaction_read_only=on`, no bypass of RLS). Schema SQL comes from `prisma migrate diff --from-empty` through a temporary config whose URL is that local server.

A nonempty `prepareClone("merge")` stored two or more User snapshot chunks, applied them, and restored the backup.

Proven on that cluster:

- Captured User rows are 2001. The calculated plan is 1999 inserts, 1 update, 2 preserved, 1 skipped. An empty Category is captured 0, not reported as an insert.
- Repeated apply of the same plan does not change the row count. A second merge plan then reports 2000 updates and 0 inserts.
- Staging administrator name, password, and token stay in place. An imported auth user is scrubbed, its generated `confirmed_at` is the least of the confirmation timestamps, and its session is removed. A development-only user remains.
- Region identity value 7 is preserved, the generated label is `Douglas!`, and bytea, numeric, timestamptz, and text-array values round-trip.
- Restore returns the pre-merge development rows.
- Source statements recorded for the reader are read-only, including `REPEATABLE READ READ ONLY` and `f.contype::text`. A direct insert as the reader is rejected. Source user count stays 2001.
- Missing SELECT, a missing reader RLS policy, a schema mismatch, and a dropped required table stop preparation with a reference id. The schema mismatch stores no chunks.
- A foreign-key failure and an injected trigger roll back. The plan stays `prepared` and the destination row is absent.
- A unique email collision becomes a plan blocker without the email value, and apply is refused.
- Prisma's composite review-response foreign key is nullable on one column. Match-simple ordering nulls only that column, so the cycle is no longer a hard blocker.
- Unique indexes created without a `pg_constraint` row are included in the conflict check.

Inserting a stored generated column fails with SQLSTATE `428C9` when the value is supplied. The apply path omits generated columns and uses `OVERRIDING SYSTEM VALUE` for `GENERATED ALWAYS` identity columns. That apply defect was not the unknown prepare exception.

## Checks

- `npx vitest run` on the worker, preflight, diagnostics, and database panel: 4 files, 29 tests passed
- `npx vitest run` on the clone suite and `__tests__/lib/database-sync-merge.integration.test.ts`: 2 files, 18 tests passed
- Project `tsc` reported errors only in the unrelated uncommitted `components/marketplace/listing-photo.tsx`. Those edits are not part of this repair.

## Not done

- Live production-reader reproduction
- Staging deploy and the authenticated Merge preparation on `itrader.dev`
- Any Merge, Replace, Reset, or Restore against the shared development database

## Next action

Set the unrelated working-tree edits aside, run TypeScript and the production build on this repair, then commit only these files and push `staging` if it can fast-forward. Recheck the deployment that serves `itrader.dev`. Do not apply a prepared plan to the shared development database.
