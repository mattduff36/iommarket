# /fixerrors

1. Run `npm run fixerrors`. This is the non-destructive export/analysis phase. It snapshots every `MonitoringIssue` with status `OPEN` from `POSTGRES_URL_NON_POOLING`, writes `private/fixerrors/error-analysis.md` and a checksum-bound snapshot, and prints a dry-run resolve command.
2. Read `private/fixerrors/error-analysis.md`. Process clusters independently. A CRITICAL auth/database/payment/concurrency cluster must not escalate unrelated FAST/STANDARD clusters.
3. External, network, third-party, expected validation, user-input, and no-defect patterns stay OPEN and report-only. Do not resolve them.
4. For each fixable cluster: inspect the suggested files, implement the root-cause fix, add or update regression tests, and run the targeted checks for that cluster.
5. After a cluster's checks pass, resolve only those exact snapshot issue IDs with the printed binding plus `--evidence` describing the checks. Add `--apply` only after the dry-run output looks correct. Never reconstruct or loosen snapshot arguments.
6. If an issue recurred after export (`lastSeenAt` or `occurrences` changed), leave it OPEN and re-export later.
7. CRITICAL clusters keep their own architecture/security/data gates. Do not push without separate authorization.
8. Summarize fixed, unresolved, skipped-stale, and report-only outcomes. Rollback, if needed, is `npm run fixerrors -- --reopen --run-id=<id> --apply`.
