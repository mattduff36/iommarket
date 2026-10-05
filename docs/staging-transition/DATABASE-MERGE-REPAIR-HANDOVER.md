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
- `npm run typecheck` passed after unrelated ImageKit edits were set aside
- `npm run build` passed on that same tree

## Deploy

- Commit `1e1c518a1f2ca84655789234e12c3211049fb494` pushed to `staging` (`599c4bb..1e1c518`)
- Rechecked 2026-10-05: `itrader.dev` now aliases deployment `dpl_7m1119i9knHRsFRBMbk4qqJhdHmL` (READY, branch `staging`, commit `20879f373222ef7aee3853564e5c9345d9d5e0fe`, listing-photo delivery). `lib/database-sync/` is unchanged between `1e1c518` and `20879f3`
- The earlier repair deployment `dpl_XrBqo96aVL1ziBTHTQkPL5yQU37E` is no longer the alias
- Local HEAD is `20879f3`. This inspection change is uncommitted. Unrelated admin-profile edits stay uncommitted. Backup stashes were not applied or dropped
- No code deploy, reset, force-push, or production promotion from this permission task

## Merge preview attempt

Signed-in Refresh inspection, then Preview merge plan, on `https://itrader.dev/admin/database`, while the alias was `dpl_XrBqo96aVL1ziBTHTQkPL5yQU37E`. Reference `f727c89b-140d-4df8-9c83-e14b8326b682` is the prepare trace id. It is not the Git commit. The same log line records commit `1e1c518a1f2ca84655789234e12c3211049fb494`.

| Request | Time (UTC) | Result |
| --- | --- | --- |
| `GET /admin/database` | 2026-10-04T22:57:11Z | 200 |
| `POST /admin/database` (Refresh inspection) | 2026-10-04T22:57:56Z | 200, info, no database-sync failure |
| `POST /admin/database` (Preview merge plan) | 2026-10-04T22:58:52Z | 200 response, error log below |

Runtime log for that reference:

- phase `source snapshot`, subphase `source.auth-users`, operation `source`
- elapsed 3747 ms
- SQLSTATE `42501`, message `permission denied for schema auth`
- failing statement `SELECT id::text AS id FROM auth.users`
- no table name, no snapshot rows, no connection string

This explains that recorded attempt only. It does not identify the discarded exception on `dpl_3PggTP8xA5jLjFcr3zTfjwFA7uyW`.

## Production USAGE grant

Authorized statement, and the only statement intended to change privileges:

`GRANT USAGE ON SCHEMA auth TO itrader_staging_reader`

Target check: repository production ref `snlqivvogfqesxpbjiei` matches direct host `db.snlqivvogfqesxpbjiei.supabase.co`, user `postgres`, and `https://snlqivvogfqesxpbjiei.supabase.co`. The preview ref was absent. The database name `postgres` was not treated as the project identity. `current_user` was `postgres`, `pg_is_in_recovery()` was false, and the transaction was read-write. This was not the reader role and not `DATABASE_SYNC_SOURCE_READONLY_URL`.

Schema `auth` is owned by `supabase_admin`. `postgres` is not a superuser, is not a member of `supabase_admin`, and holds `USAGE` without grant option (`postgres=U/supabase_admin`).

The statement was executed twice. Neither changed the access list. The instrumented execution returned command `GRANT` with warning SQLSTATE `01007`, message `no privileges were granted for "auth"`.

`itrader_staging_reader` before and after, from that `postgres` session:

| Check | Before | After |
| --- | --- | --- |
| `USAGE` on schema `auth` | absent | absent |
| `CREATE` on schema `auth` | absent | absent |
| `USAGE` on schema `public` | present, not grantable | unchanged |
| `SELECT` on `auth.users` | present | unchanged |
| `INSERT`/`UPDATE`/`DELETE` on `auth.users` | absent | unchanged |
| `SELECT` on `auth.identities` | present | unchanged |
| `INSERT`/`UPDATE`/`DELETE` on `auth.identities` | absent | unchanged |
| superuser, `BYPASSRLS`, createrole, createdb, replication | absent | unchanged |
| inherit | off | unchanged |

No other grant, RLS policy, password, or role membership was changed. The deployed reader `LIMIT 0` probe was not run: `DATABASE_SYNC_SOURCE_READONLY_URL` is not in the local env files and was not decrypted. The catalog result is not that reader probe.

## Preview after the grant attempt

Not run. The grant did not take effect, so a new Merge preview would repeat the same source failure. The alias had also moved to `dpl_7m1119i9knHRsFRBMbk4qqJhdHmL`. No saved plan, counts, or blockers were produced. No Merge, Replace, Reset, or Restore was applied.

## Inspection gap

Local only, not deployed. Source inspection and `validateSourceClient` now require `USAGE` on schemas `public` and `auth` after the existing SELECT checks. Preparation still calls that validation inside its read-only source snapshot transaction. The missing-access message is `Production source role lacks USAGE on schema auth.`

Isolated PostgreSQL regression, with SELECT retained on `auth.users` and `auth.identities`: revoking `USAGE` on `auth` makes `inspectConnection` throw that message and `prepareClone("merge")` reject with the same explanation plus a reference id. Restoring `USAGE` lets `validateSourceClient` and zero-row reads of those two tables pass. Production permissions were not revoked for the test.

Checks run: `npx vitest run` on the preflight and merge integration files, 2 files, 14 tests passed. `npm run typecheck` passed.

## Not done

- The production `USAGE` grant, which needs a role that owns schema `auth` or holds `USAGE` with grant option. That role is `supabase_admin`, not the `postgres` login used here
- A deployed-reader `BEGIN READ ONLY` with `SELECT * FROM auth.users LIMIT 0` and the same for `auth.identities`
- A new signed-in Merge preview after the grant is actually present
- Commit or staging deploy of the inspection check
- Any Merge, Replace, Reset, or Restore against the shared development database
- Real destination trigger and constraint coverage, because no plan was stored

## Next action

Run only `GRANT USAGE ON SCHEMA auth TO itrader_staging_reader` as `supabase_admin` on project `snlqivvogfqesxpbjiei`. Confirm the reader ACL gains `USAGE` and then probe the deployed reader with the two zero-row statements inside `READ ONLY`. After that, sign in at `https://itrader.dev/admin/database`, refresh inspection, and preview Merge once. Do not apply Merge, Replace, Reset, or Restore. Do not deploy the local inspection change in the same step as that permission-only preview.


## CURRENT ? direct ChatGPT takeover, 5 October 2026

This supersedes the earlier Next action to retry the unsuccessful auth-schema grant. ChatGPT has implemented a candidate private Auth-export source adapter in the separate detached worktree `D:\Websites\iommarket-dbmerge-auth-export`, based on 20879f3. The application changes have not been copied into this shared workspace, committed or deployed.

Read `docs/staging-transition/AUTH-EXPORT-REPAIR-STATUS.md` for the complete checkpoint and exact candidate file list. Read-only hosted prerequisite checks confirmed postgres is non-superuser with existing BYPASSRLS, can create a private schema, and can read all 32 Auth users/identities. No production permissions, schema or records were changed. The effective Data API exposed-schema list remains unverified.

43 non-database tests, scoped ESLint and the final TypeScript check passed. The tool blocked the command to add the extra security cases and run the local PostgreSQL integration test. That operation was not retried or bypassed. No new integration success is claimed and no test PostgreSQL cluster was started by this task. The candidate is NOT release-ready. Extra security cases remain drafted in `.extra-integration-tests.txt` inside the isolated worktree.

Next gate: obtain approval to retry the disposable LOCAL PostgreSQL verification, then review its results before any scoped staging integration or separately approved production provisioning. Do not apply any shared-development Merge/Replace/Reset/Restore. Existing admin-profile, ImageKit and database-inspection edits and backup stashes are preserved.


## CURRENT: approved local verification passed, 5 October 2026

This supersedes the previous blocked/unexecuted local-test checkpoint. Desktop Commander reconnected under device ID 1b3f8930-86a2-4818-9353-01fefe88d57a. The earlier approved run had completed with seeding failures in the disposable fixture. Its Auth table-owning role lacked schema USAGE. Only the local fixture was corrected, with no new runtime-reader privilege.

The approved repeat passed: 8 direct-mode integration tests and 10 private-view-mode integration tests, plus 43 non-database tests. Mode-specific skips are intentional. TypeScript, fixture/integration ESLint and whitespace checks passed. Both disposable PostgreSQL instances stopped. Shared database code SHA-256 hashes are unchanged, and the backup stashes remain intact.

Read docs/staging-transition/AUTH-EXPORT-REPAIR-STATUS.md for exact logs and remaining checks. Candidate code is still only in D:\Websites\iommarket-dbmerge-auth-export, not committed or deployed. No hosted database was queried or modified by this verification task, and no shared-development merge was applied.

The next gate is separate approval for the scoped production private-view provisioning and staging-only configuration/deployment, after release checks and hosted API exposure verification. That approval must not include applying Merge/Replace/Reset/Restore to shared development. Local fixture success does not establish hosted reader or all real-destination trigger/restore compatibility.


## Staging rollout requested - 2026-10-05T00:40:20.494Z

The owner requested immediate deployment without another verification cycle. The previously tested repair has been synchronized into the staging workspace, excluding concurrent admin-profile and ImageKit edits.

The remote tool blocked creation of the production-export provisioning runner before it executed. No production SQL or grants ran, and the private export is NOT installed. This denial was not retried through another tool. The staging code rollout is proceeding independently. DATABASE_SYNC_AUTH_SOURCE_MODE remains its existing default (direct); private-views is not enabled before its required production objects exist. The auth-schema access blocker therefore remains.

No data Merge, Replace, Reset or Restore is authorized or performed by this deployment. No additional integration tests or signed-in Merge preview were run. Deployment result will be appended after Vercel completes.
