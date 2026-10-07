# /fixerrors

1. Run `npm run fixerrors`. This reads `.env.production` and exports every open `MonitoringIssue` from the production database. It fetches `origin/main` and `origin/staging`, records both commit SHAs and the blob hash of every suggested file, and writes `private/fixerrors/error-analysis.md`, `private/fixerrors/decision.json`, and a checksum-bound snapshot. Use `--database=preview`, `--database=staging`, or `--database=development` only when the production queue is not the one being fixed.
2. Acknowledge those issues before investigation. Run the printed command, then the same command with `--apply` after the dry-run lists the unchanged issues. The printed binding uses `--database-fingerprint`. Do not pass that value as `--database`. Acknowledgement does not change fingerprint, occurrence count, or last seen time. Issues that changed after export stay `OPEN` until close-out.
3. Read the decision manifest, the "What we already know" section, and the production/staging section of the analysis. That section is built from `private/fixerrors/alert-log.jsonl` plus committed fixes. Use it before choosing a repair:
   - Same error seen before, with a fix that held: start from that fix and confirm it still applies.
   - Same error came back after a fix: do not repeat that change. The decision is `needs-person`. Investigate a different cause.
   - Similar error fixed before: use that note as a hint, then check the current code.
   - No earlier record: this run has added the error to the log for the next launch.
   Dispositions are hints:
   - `auto-repair` (`fast`, `standard`, `guarded`): fix the cluster only when every suggested file exists in both `origin/main` and `origin/staging`. A differing blob is reported and does not by itself block the repair. Additional existing callers are checked against those same snapshot-bound commits. Declare genuinely new helpers/tests explicitly with `--new-paths=<files>`; they must be absent from both bound commits and `HEAD`, and included in the independently reviewed diff.
   - A missing file, or refs that could not be compared, sets `blockReason` and changes the action to `needs-person`. Leave that issue acknowledged and record the next step.
   - `pause-for-approval`: do not change the code. Close the issues as `acknowledged` and say what approval is required.
   - `mute-noise`: expected user input or validation noise, unless investigation shows a code defect or tooling that is too sensitive.
   - `needs-person`: external, third-party, unknown, or incompatible-ref issues that need a person, unless investigation shows a code defect or tooling that is too sensitive.
4. Check out `staging` and update it so it is not behind `origin/staging`. Before editing, confirm the repair paths are clean:

```bash
npm run fixerrors -- --prepare-repair --paths=<files>
```

5. For each unblocked auto-repair cluster, and for any other cluster that investigation shows is a real defect or over-sensitive tooling: implement the root-cause fix on `staging`, add or update regression tests, and run the targeted checks. Over-sensitive tooling means the capture, threshold, or classifier should change so the alert stops firing. An opaque `Script error` is not proof of noise. Check historical configuration errors against current read-only evidence before claiming the configuration is still wrong. Keep security checks intact.

   Reuse already-read files while their content is unchanged; batch independent lookups, limit dependency searches to a specific package, and stop broad searches once the cause is established. Record elapsed time, tool count, model routing and available usage counters; do not invent a billed cost. Regression tests must exercise the failure, including malformed and boundary inputs. Normal tests must never automatically load production credentials; provider/database integration tests require an explicit test connection.

   An independent reviewer must inspect the actual diff and tests. Write `private/fixerrors/reviews/<cluster-id>.json` with `testsPassed`, `independentReview`, `reviewer`, `reviewerEvidence`, `reviewedDiffSha256`, `evidence`, the exact repaired `issueIds`, a short sanitized `summary`, and `tests`. Stage only the reviewed repair paths and calculate `reviewedDiffSha256` from the raw bytes of `git diff --cached --binary -- <paths>`; do not hash a shell-reformatted string. The review must name the reviewer and substantive evidence, not merely assert a boolean. A mixed cluster may have a non-empty reviewed subset; never include unrelated issue IDs as fixed. Unrelated staged work is rejected. A changed diff requires another review.
6. Stage exactly the reviewed paths first. Dry-run the local commit, then apply it only after the dry run is correct. Both modes check the real staged paths and reviewed diff hash. Apply commits a separate snapshot of that index so later unrelated staging cannot enter the commit; the real index is not reset. Do not run concurrent commits in the shared checkout. The cluster fingerprint is derived from the signed issue fingerprints. The commit is rejected on `main`, a detached HEAD, a feature branch, or a staging branch that is behind `origin/staging`. It writes `private/fixerrors/runs/<cluster-id>/release.json`. It must never be given `--push`:

```bash
npm run fixerrors -- --commit-cluster --cluster-id=<id> --lane=<lane> --issue-ids=<ids> --paths=<files> --review=private/fixerrors/reviews/<id>.json
npm run fixerrors -- --commit-cluster --cluster-id=<id> --lane=<lane> --issue-ids=<ids> --paths=<files> --review=private/fixerrors/reviews/<id>.json --apply
```

7. Push the staging commit with `/fap` or `/ffap`. Confirm the preview deployment. Open an approved pull request from `staging` to `main`. Do not push `main` directly. A squash or rebase that drops the staging commit stays acknowledged.
8. Close every snapshot issue in `private/fixerrors/close.json`. Each snapshot issue appears once:
   - `pending-release` with `nextStep` when the fix is committed on staging but is not yet confirmed in production. The issue stays `ACKNOWLEDGED`.
   - `acknowledged` with `nextStep` when a person still needs to act. This includes critical approval, external failures, missing code refs, failed repairs, and issues that recurred after export.
   - `muted` with `nextStep` for expected noise that should not keep alerting. Mute lasts 30 days, then the issue reopens for another triage.
   Do not use `resolved` here. `nextStep` is at most 500 characters and must not contain an email address. It is stored on the monitoring issue and copied into the summary.

```bash
npm run fixerrors -- --close --close-manifest=private/fixerrors/close.json <snapshot-binding>
npm run fixerrors -- --close --close-manifest=private/fixerrors/close.json <snapshot-binding> --apply
```

9. Read `private/fixerrors/summary.md`. Pending-release issues are not resolved yet. Repeat each next step in the summary.
10. After the fix commit is an ancestor of both `origin/staging` and `origin/main`, and GitHub reports a successful completed Vercel deployment for the current `origin/main` SHA, resolve the cluster:

```bash
npm run fixerrors -- --verify-release --cluster-id=<id>
npm run fixerrors -- --verify-release --cluster-id=<id> --apply
```

   This check does not use the 30-minute export expiry. It requires the deployed source blobs to still match the reviewed repair, so a later revert cannot resolve an issue merely through commit ancestry. Changed content requires explicit re-review. It resolves an issue only when the signed fingerprint still matches and `lastSeenAt` is not later than the Vercel completion time. Recurrence before deployment can still be resolved. Recurrence after deployment stays `ACKNOWLEDGED` with a remediation note. Authentication failure, a missing or pending Vercel status, or a newer unverified `origin/main` SHA also leaves the issue acknowledged. Existing release manifests cannot be overwritten; retain their evidence.
11. CRITICAL clusters keep their own architecture, security, and data gates. Rollback of issues resolved by a verify-release run is `npm run fixerrors -- --reopen --run-id=<id> --apply`.

12. Correct a mistaken mute using the original archived snapshot and mute run, with explicit issue IDs and a sanitized reason. Dry-run first, inspect exactly which issues would be acknowledged, then repeat with `--apply`:

```bash
npm run fixerrors -- --reopen-muted --run-id=<mute-run-id> --snapshot-file=private/fixerrors/snapshots/<snapshot-id>.json --issue-ids=<ids> --evidence="Reason for correcting the mute"
```

   This acknowledges rather than resolves. It verifies the original snapshot and database, unchanged fingerprints/occurrences/last-seen times, and the latest matching mute audit and status event. A newer action or recurrence blocks the entire correction. It records status and admin audit events. Historical corrections do not use export expiry because they undo a precisely identified prior action; they do not authorize unrelated status changes.
