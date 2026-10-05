# Database Merge: Apply feedback and disabled controls

## Current code repair — 5 October 2026

Owner requested direct repair and staging deployment after Apply gave no visible result and the saved plan remained Prepared. Restore the original three-card layout with Replace, Reset and Restore visible but disabled. Keep all approved exclusions and do not apply another hosted merge.

Baseline: staging b2e22f6182aaca73a45b2887c7881a433591ec96. Unrelated ImageKit/admin-profile files and existing handover edits are excluded from this change.

## Evidence

Vercel deployment dpl_GhLYxaK7swVVnFzJweQPePsthEaR logged `Database sync operation failed. { operation: 'apply' }` at 2026-10-05T02:31:13Z. It discarded the original exception. Do not claim the original first exception was recovered.

A bounded, verified-TLS, read-only development query found plan 4973a000-0789-42d3-9409-7448dc16ee29, created at 02:30:08.945Z, still Prepared, applied_at null, backup_bytes 0, and no preparation blockers.

The plan schedules updates to CostLedgerConfig (1 row), FxRateSnapshot (5), CostSourceSnapshot (8) and CostEntry (9). Their deployed cost_forbid_mutation triggers unconditionally reject UPDATE or DELETE. Separate read-only whole-row hash comparisons found all 23 matching rows identical across production and development. The generic upsert nevertheless issues UPDATE, which is a definite Apply defect. No customer record values were printed. An optional Management API log request returned 401, so no underlying PostgreSQL error log is claimed.

## Changes

- Extracted the insert/upsert SQL builder to lib/database-sync/merge-write.ts. Matching typed writable values are compared before UPDATE. An identical record is not rewritten. New records are inserted. Real changes still encounter normal immutable triggers and other constraints. No permissions, schemas, trigger rules or data exclusions changed.
- Apply now records the failing subphase/table and a sanitized reference. Confirmed rollback is distinguished from uncertain commit outcome. Successful completion is logged only after COMMIT returns.
- Post-commit cache refresh failure returns the saved successful result with a warning, rather than claiming the database save failed.
- The client acknowledges preparation/application immediately, focuses and scrolls to its feedback, guards double submissions, and confirms success only when the returned state is Applied.
- A lost/unconfirmed response blocks resubmission and offers a read-only Refresh history action. It never silently reruns Apply.
- Original three-column desktop cards restored. Replace and Reset buttons remain disabled. Restore buttons are visible in history and disabled. Server-side restrictions remain intact.

## Focused verification

Only three relevant files were run, 14 cases total: 7 component feedback/layout cases, 3 real-PostgreSQL immutable-upsert cases, and 4 existing diagnostics/count cases. All passed, exit 0.

The real PostgreSQL regression uses a unique disposable local cluster on 127.0.0.1:55438 and one synthetic table with an unconditional immutable trigger. It reproduces the old error, inserts a new row without rewriting an identical one, and verifies a genuine change remains blocked. It does not use application env files or hosted databases. Cleanup stops only its own cluster.

Logs: D:\Websites\iommarket-dbmerge-auth-export\.apply-feedback-checks-1791168436573\checks.log.

No full test suite, browser automation, full database-merge regression, hosted Apply/Replace/Reset/Restore, migration or production configuration change was run. A real hosted Apply remains the owner's manual next step after the new staging deployment is READY. Existing plans may have expired, so prepare a fresh preview.

Deploy only these scoped changes to staging. Record the resulting deployment ID locally, not in a recursive docs-only deployment. Main/production and concurrent work remain unchanged.

## Deployment receipt — confirmed live

Commit `3bb8dd576849b534d3e520f23a7defd5cf2083da` was pushed to staging with only the eight scoped files. Vercel deployment `dpl_GLBcUFMbNPDhvrLB54WpK42qA5wd` is READY, and resolving `itrader.dev` returns this exact deployment and SHA. The normal staging build completed. Main remains `e3f77faae74ca787936853426798ea546ef89bff`. The two repair backup stashes remain present. No listener remained on disposable test port 55438. No hosted data merge or schema/permission change was run by this task. This receipt is local/uncommitted to avoid a documentation-only redeployment.
