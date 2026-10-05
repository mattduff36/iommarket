# Auth export repair: local verification passed

Updated 5 October 2026, after reconnecting Desktop Commander and retrieving the completed test runs.

## Current state and authorization boundary

The candidate remains in the separate detached worktree `D:\Websites\iommarket-dbmerge-auth-export`, based on `20879f373222ef7aee3853564e5c9345d9d5e0fe`.

The user approved disposable LOCAL PostgreSQL integration tests. Those tests are now complete and passing. This supersedes all earlier statements that the expanded tests had not been inserted, were blocked, or had not run.

No production grants, schema objects, records, hosted queries or configuration were changed by this verification/reconnect task. No shared-development Merge, Replace, Reset or Restore was run. Nothing was committed, pushed, merged or deployed. The candidate application changes are not copied into the shared staging workspace.

## Recovered failed run and correction

The first approved run completed while Desktop Commander was disconnected. Its results were recovered from `.local-verification-2026-10-04T23-57-12-040Z` in the candidate worktree. Both modes failed while seeding dummy Auth identities, before exercising Merge.

The fixture assigned both Auth tables to `supabase_auth_admin`, but omitted that fixture role's schema access. The foreign-key check failed with SQLSTATE 42501 on an internal query against `auth.users`.

The only code correction in this reconnect task is in `__tests__/lib/database-sync-auth-fixture.ts`: grant USAGE on the disposable fixture's auth schema to its table-owning `supabase_auth_admin` role. This does not grant access to the restricted reader and is not a production provisioning statement. The private-mode reader still has no auth schema USAGE.

The drafted security cases were already inserted exactly once by the first approved runner. They were not duplicated.

## Verified results

Evidence directory in the candidate worktree:
`.local-verification-2026-10-05T00-27-45-671Z`

| Check | Result |
| --- | --- |
| Direct Auth integration mode | 8 passed, 4 private-only cases skipped, exit 0 |
| Private Auth views integration mode | 10 passed, 2 direct-only cases skipped, exit 0 |
| Five-file non-database regression suite | 43 passed, exit 0 |
| TypeScript, `tsc --noEmit --incremental false` | Exit 0 |
| ESLint on fixture and integration test | Exit 0 |
| `git diff --check` | Exit 0; ordinary LF/CRLF notices only |

The 18 integration executions are across two modes of a 12-case suite. Mode-specific skips are intentional, not missing execution of those cases across the complete matrix. The private export setup was executed only in the disposable local source database.

Direct mode completed 2026-10-05T00:29:08.712Z. Private mode completed 2026-10-05T00:30:43.382Z. Static checks completed at 00:30:52.498Z. Times are UTC.

Logs: `direct.log`, `private.log`, and `results.json` in the evidence directory. Current unit/type logs are `.reconnect-unit.log`, `.reconnect-types.log`, and `.reconnect-static-results.json` in the candidate root. `candidate-sha256.json` records tested code hashes. `shared-after.json` confirms the three shared database-code files matched their pre-run hashes.

## What the real local tests establish

- Both modes prepare a nonempty snapshot, apply Merge, repeat the application/merge, and restore a previous backup using real PostgreSQL.
- A 2,001-row User source crosses the snapshot page boundary. Insert/update/preserve/skip counts are asserted, and development-only records remain.
- Staging administrator data and login credentials remain intact. Imported Auth identities are made non-login, known secret fields are scrubbed, and imported sessions are removed.
- Generated/identity columns and representative binary, numeric, timestamp and array values round-trip.
- The private views are provisioned by a non-superuser fixture postgres role with existing BYPASSRLS. The runtime reader has neither BYPASSRLS nor USAGE on auth.
- The reader receives complete masked Auth rows through the private views, but direct Auth reads remain denied.
- View INSERT/UPDATE/DELETE are denied even in a read-write transaction. SQL access by anon, authenticated and service_role is denied.
- Unsafe added grants, missing schema access/views, filtered view definitions, lost owner RLS visibility and source-column drift stop preparation.
- Direct mode catches missing auth USAGE and silent Auth RLS filtering. Both modes reject missing required tables, schema mismatches, and unique conflicts.
- Foreign-key and injected-trigger failures roll back without marking a plan applied.

These are local fixture results, not a hosted production-reader or shared-development test. PostgreSQL 18 was used locally; the hosted prerequisite check previously recorded PostgreSQL 17.6. The fixture does not reproduce every migration-defined trigger in the deployed application. SQL API-role denial is not a test of the hosted HTTP Data API configuration.

## Cleanup and preservation

After the run, neither 127.0.0.1:55435 nor :55436 had a listener. No running PostgreSQL process referenced an `iommarket-auth-export-it-*` fixture. The separate MPDEE Accounts PostgreSQL instance was not stopped or modified.

The shared `D:\Websites\iommarket` preflight, clone engine, and integration-test files matched their pre-run SHA-256 hashes. Concurrent admin-profile/ImageKit work and all backup stashes were left intact. Only this status document and a short handover update are synchronized to the shared workspace.

## Candidate implementation retained

- `lib/database-sync/auth-source.ts`: explicit direct/private-views mode and fixed private-view validation. No automatic fallback.
- `lib/database-sync/auth-export-contract.ts`: versioned physical Auth schema contract.
- `lib/database-sync/clone-engine.ts`: redirects only source Auth reads. Logical snapshot names and destination/backup/restore remain auth.users/auth.identities.
- `lib/database-sync/preflight.ts`: schema checks, Auth counts/signatures and mode-specific access/RLS validation.
- `scripts/database-sync/auth-export-provisioning.ts`: pure proposed SQL generator, no connection or automatic execution.
- `docs/staging-transition/PRODUCTION-AUTH-EXPORT.sql` and `PRODUCTION-AUTH-EXPORT-ROLLBACK.sql`: proposed setup/removal of one private schema and two masked views. Neither has been executed on a hosted database.

The private view's stored definition digest detects later drift; it is not protection against a malicious database owner. API/public grants must remain excluded, and the private schema must not be exposed through the hosted Data API.

## Next gate: not authorized by the local-test approval

1. Review the current shared staging state and synchronize only the candidate repair, preserving concurrent work. Run the applicable release checks/full build; no full build is claimed by this checkpoint.
2. Obtain separate approval before executing the exact private-export provisioning SQL on verified production project `snlqivvogfqesxpbjiei` and changing the staging-only `DATABASE_SYNC_AUTH_SOURCE_MODE` setting.
3. Verify the effective hosted Data API exposed-schema configuration, the real reader permissions, masked source access and view contract. Never replace the restricted reader with an administrator connection.
4. Deploy the scoped application change only to staging and verify a signed-in Merge PLAN PREPARATION through itrader.dev, without bypassing admin or Origin checks.
5. Review stored plan coverage, counts, blockers and remaining real-destination trigger/restore risks before asking for separate shared-development Apply approval.

Do not retry the known ineffective auth-schema GRANT as the normal postgres login. Do not apply any hosted/shared-development Merge, Replace, Reset or Restore without separate explicit authorization.


## Staging rollout requested - 2026-10-05T00:40:20.494Z

The owner requested immediate deployment without another verification cycle. The previously tested repair has been synchronized into the staging workspace, excluding concurrent admin-profile and ImageKit edits.

The remote tool blocked creation of the production-export provisioning runner before it executed. No production SQL or grants ran, and the private export is NOT installed. This denial was not retried through another tool. The staging code rollout is proceeding independently. DATABASE_SYNC_AUTH_SOURCE_MODE remains its existing default (direct); private-views is not enabled before its required production objects exist. The auth-schema access blocker therefore remains.

No data Merge, Replace, Reset or Restore is authorized or performed by this deployment. No additional integration tests or signed-in Merge preview were run. Deployment result will be appended after Vercel completes.
