# /fixerrors

1. Run `npm run fixerrors`. This is the non-destructive export/analysis phase. It snapshots every `MonitoringIssue` with status `OPEN` from `POSTGRES_URL_NON_POOLING`, writes `private/fixerrors/error-analysis.md`, `private/fixerrors/decision.json`, and a checksum-bound snapshot, and prints a dry-run resolve command.
2. Read the decision manifest. `auto-repair` lanes are `fast`, `standard`, and `guarded`. Repair those clusters one at a time. A `pause-for-approval` critical cluster must stop for explicit approval. `report-only` clusters stay open.
3. External, network, third-party, expected validation, user-input, and no-defect patterns stay OPEN and report-only. Do not resolve them.
4. For each auto-repair cluster: inspect the suggested files, implement the root-cause fix, add or update regression tests, and run the targeted checks for that cluster. Write `private/fixerrors/reviews/<cluster-id>.json` with `testsPassed`, `independentReview`, `evidence`, the exact `issueIds`, a short sanitized `summary`, and `tests`.
5. Dry-run the local commit, then apply it only after the dry run is correct. This creates one local commit and records sanitized knowledge. It must never be given `--push`:

```bash
npm run fixerrors -- --commit-cluster --cluster-id=<id> --lane=<lane> --fingerprint=<fingerprint> --issue-ids=<ids> --paths=<files> --review=private/fixerrors/reviews/<id>.json
npm run fixerrors -- --commit-cluster --cluster-id=<id> --lane=<lane> --fingerprint=<fingerprint> --issue-ids=<ids> --paths=<files> --review=private/fixerrors/reviews/<id>.json --apply
```

6. After a cluster's checks pass, resolve only those exact snapshot issue IDs with the printed binding plus `--evidence` describing the checks. Add `--apply` only after the dry-run output looks correct. Never reconstruct or loosen snapshot arguments.
7. If an issue recurred after export (`lastSeenAt` or `occurrences` changed), leave it OPEN and re-export later.
8. CRITICAL clusters keep their own architecture/security/data gates. Do not push without separate authorization.
9. Summarize fixed, unresolved, skipped-stale, and report-only outcomes. Rollback, if needed, is `npm run fixerrors -- --reopen --run-id=<id> --apply`.
