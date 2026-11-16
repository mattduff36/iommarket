# Fixerrors mechanical command reference

The active workflow is `.cursor/commands/fixerrors.md`: the chat engineer owns
investigation and repair decisions. This reference preserves mutation arguments
and safety contracts; its legacy classifier terms are advisory. `needs-person`
means engineer investigation, not a request for the user to diagnose the issue.

For an independently reviewed non-critical repair, add `--engineer-reviewed`
to both dry-run and apply `--commit-cluster` commands. Use the bound original
lane, including `report-only` (stored as guarded in the release record). This
overrides only automatic eligibility, not identity, snapshot, path, diff review,
tests or release validation. CRITICAL gates remain. Unproven preventive
mitigations use the ordinary project workflow and stay in investigation records;
do not feed them into automatic issue resolution as proven repairs.

## Completion means a fix or better evidence

Read `private/fixerrors/acknowledged-backlog.md` on every run. Acknowledged issues remain unresolved work; an empty OPEN export is not a clean bill of health. The backlog is read-only and does not grant mutation authority outside the checksum-bound snapshot. Checksums detect changed bytes; they are not cryptographic signatures or proof of authenticity.

For every unresolved issue, establish the cause and fix it where possible. If existing evidence cannot establish the cause, identify the missing facts and implement a bounded, privacy-safe collection path with regression tests. Record the collector, required deployment, trigger, expected evidence and next investigation step. “Monitor”, “retry”, or “ask the user” alone is not an adequate technical close-out. A genuine account/support action can still be required, but distinguish it from an uninvestigated defect.

Never mute generic network failures, failed RSC requests or opaque errors merely because their message is common. Inspect raw event provenance: older CLIENT events may contain a server stack manufactured by the ingest endpoint, which is not the fault's origin. Source-file suggestions and route proximity are hints, not root-cause evidence. Diagnostic improvements are not proof that the underlying error is resolved.

1. Run `npm run fixerrors`. This reads `.env.production` and exports every OPEN and ACKNOWLEDGED `MonitoringIssue` from the production database. It fetches `origin/main` and `origin/staging`, records both commit SHAs and the blob hash of every suggested file, and writes `private/fixerrors/error-analysis.md`, `private/fixerrors/decision.json`, and a checksum-bound snapshot. Use `--database=preview`, `--database=staging`, or `--database=development` only when the production queue is not the one being fixed.
2. Normal `npm run fixerrors` automatically acknowledges unchanged OPEN issues after collecting them, preserving the input snapshot and result under `private/fixerrors/acknowledgements/`, then refreshes the report from the database. Existing ACKNOWLEDGED issues remain unresolved and are not acknowledged again. A concurrent new or changed issue stays OPEN for the next run. The explicit `--acknowledge` command remains available for snapshot-bound dry-run/apply recovery; its binding uses `--database-fingerprint`, not `--database`. Acknowledgement never changes fingerprint, occurrence count or last seen time and never means fixed.
3. Read the decision manifest, the "What we already know" section, and the production/staging section of the analysis. That section is built from `private/fixerrors/alert-log.jsonl` plus committed fixes. Use it before choosing a repair:
   - Same error seen before, with a fix that held: start from that fix and confirm it still applies.
   - Same error came back after a fix: do not repeat that change. The decision is `needs-person`. Investigate a different cause.
   - Similar error fixed before: use that note as a hint, then check the current code.
   - No earlier record: this run has added the error to the log for the next launch.
   Dispositions are hints:
   - `auto-repair` (`fast`, `standard`, `guarded`): each issue must have its own high-confidence original source frame, and every suggested file must exist in both `origin/main` and `origin/staging`. A sibling issue's stack cannot confer eligibility. CLIENT stacks require explicit `clientStackProvided=true`; historical ingest-manufactured stacks are ignored. Route, action and compiled-chunk mappings remain low-confidence investigation hints, never root-cause proof. A differing blob is reported and does not by itself block the repair. Additional existing callers are checked against those same snapshot-bound commits. Declare genuinely new helpers/tests explicitly with `--new-paths=<files>`; they must be absent from both bound commits and `HEAD`, and included in the independently reviewed diff.
   - A missing file, or refs that could not be compared, sets `blockReason` and changes the action to `needs-person`. Leave that issue acknowledged and record the next step.
   - `pause-for-approval`: continue investigation, regression tests and privacy-safe diagnostics. Security-sensitive or production changes retain their approval gates; record the exact blocker and collector. The classifier does not prohibit investigation.
   - `mute-noise`: expected user input or validation noise, unless investigation shows a code defect or tooling that is too sensitive.
   - `needs-person`: external, third-party, unknown, or incompatible-ref issues that need a person, unless investigation shows a code defect or tooling that is too sensitive.
4. Check out `staging` and update it so it is not behind `origin/staging`. Before editing, confirm the repair paths are clean:

```bash
npm run fixerrors -- --prepare-repair --paths=<files>
```

5. For each unblocked auto-repair cluster, and for any other cluster that investigation shows is a real defect or over-sensitive tooling: implement the root-cause fix on `staging`, add or update regression tests, and run the targeted checks. Over-sensitive tooling means the capture, threshold, or classifier should change so the alert stops firing. An opaque `Script error` is not proof of noise. Check historical configuration errors against current read-only evidence before claiming the configuration is still wrong. Keep security checks intact.

   Reuse already-read files while their content is unchanged; batch independent lookups, limit dependency searches to a specific package, and stop broad searches once the cause is established. Record elapsed time, tool count, model routing and available usage counters; do not invent a billed cost. Regression tests must exercise the failure, including malformed and boundary inputs. Normal tests must never automatically load production credentials; provider/database integration tests require an explicit test connection.

   An independent reviewer must inspect the actual diff and tests. Write `private/fixerrors/reviews/<cluster-id>.json` with `testsPassed`, `independentReview`, `reviewer`, `reviewerEvidence`, `reviewedDiffSha256`, `evidence`, the exact repaired `issueIds`, a short sanitised `summary`, and `tests`. Stage only the reviewed repair paths and calculate `reviewedDiffSha256` from the raw bytes of `git diff --cached --binary -- <paths>`; do not hash a shell-reformatted string. The review must name the reviewer and substantive evidence, not merely assert a boolean. A mixed cluster may have a non-empty reviewed subset; never include unrelated issue IDs as fixed. Unrelated staged work is rejected. A changed diff requires another review.
6. Stage exactly the reviewed paths first. Dry-run the local commit, then apply it only after the dry run is correct. Both modes check the real staged paths and reviewed diff hash. New repairs also require decision manifest v3: its exact bytes are bound into the snapshot, with the same snapshot ID, issue checksum, baseline, complete unique membership and requested lane. Legacy unbound decisions require re-export; archived release verification remains readable. Apply commits a separate snapshot of that index so later unrelated staging cannot enter the commit; the real index is not reset. Do not run concurrent commits in the shared checkout. The cluster fingerprint is derived from the snapshot-bound issue fingerprints. The commit is rejected on `main`, a detached HEAD, a feature branch, or a staging branch that is behind `origin/staging`. It writes `private/fixerrors/runs/<snapshot-id>/<cluster-id>/release.json`. It must never be given `--push`:

```bash
npm run fixerrors -- --commit-cluster --cluster-id=<id> --lane=<lane> --issue-ids=<ids> --paths=<files> --review=private/fixerrors/reviews/<id>.json
npm run fixerrors -- --commit-cluster --cluster-id=<id> --lane=<lane> --issue-ids=<ids> --paths=<files> --review=private/fixerrors/reviews/<id>.json --apply
```

7. Push the staging commit with `/fap` or `/ffap`. Confirm the preview deployment. Open an approved pull request from `staging` to `main`. Do not push `main` directly. A squash or rebase that drops the staging commit stays acknowledged.
8. Cover every unresolved snapshot issue exactly once in `private/fixerrors/investigations.json`. Use `{ "issueId": "...", "action": "retain" }` for an existing valid plan, even if overdue: this preserves its entire stored record, review date, occurrence baseline, status, timestamps and audit history without collector revalidation or issue writes. Use `{ "issueId": "...", "action": "update", "investigation": { ... } }` for changed/new plans (`action` omitted remains a legacy update). Updates use `lib/monitoring/investigation.ts` as the closed schema and require finding, evidence, missingEvidence, owner, nextAction, reviewAfter and a collector with existing paths/tests, trigger, expectedEvidence, state and (when deployed) deploymentSha. All retained and updated identities and complete stored-review checksums are locked and checked before any write; a concurrent review rejects the whole batch. Outcomes: collecting-evidence, external-blocker, pending-release, expired. Acknowledgement alone is not completion. A historical issue may be expired only when at least 14 days old, the missing evidence cannot be recovered, and the collector is verified in production. Age alone is never the reason. Expired is distinct from resolved and automatically reopens on recurrence.

   Generate a draft locally without loading environment files, contacting the database or overwriting an existing output:

```bash
npm run fixerrors -- --draft-investigations --snapshot-file=<snapshot.json> --output=<new-manifest.json>
```

   Valid existing plans become retain entries. Missing plans become deliberately incomplete updates: supply actual evidence, never invented findings. Retain-only recording needs no Git/ref/deployment checks. Updated collectors verify both source and test files against immutable fetched commit SHAs, deduplicating Git lookups within this invocation only; changed local bytes invalidate their local hash.

```bash
npm run fixerrors -- --record-investigations --investigation-manifest=private/fixerrors/investigations.json <snapshot-binding>
npm run fixerrors -- --record-investigations --investigation-manifest=private/fixerrors/investigations.json <snapshot-binding> --apply
```

   Verify the dry run before apply. Any concurrent occurrence, wrong target or incomplete coverage rejects the entire update. The record and bounded evidence bundle are stored on the issue and in the admin audit. The old `--close` entry point is now for proven-noise muting only; it cannot substitute a vague next step for an investigation. Never mute a failure merely for lacking evidence.
9. Check the report for missing records, overdue reviews and recurrences. Run `--resume-releases` to reconcile archived release manifests before choosing a new repair; inspect the dry run, then apply. Each blocked record is reported without stopping other records. Historical snapshots remain immutable, and per-snapshot release paths prevent cluster-number reuse from overwriting earlier evidence.

10. After the fix commit is an ancestor of both `origin/staging` and `origin/main`, and GitHub reports a successful completed Vercel deployment for the current `origin/main` SHA, resolve the cluster:

```bash
npm run fixerrors -- --verify-release --cluster-id=<id>
npm run fixerrors -- --verify-release --cluster-id=<id> --apply
```

   This check does not use the 30-minute export expiry. It requires the deployed source blobs to still match the reviewed repair, so a later revert cannot resolve an issue merely through commit ancestry. Changed content requires explicit re-review. It resolves an issue only when the snapshot-bound fingerprint still matches and `lastSeenAt` is not later than the Vercel completion time. Recurrence before deployment can still be resolved. Recurrence after deployment stays `ACKNOWLEDGED` with a remediation note. Authentication failure, a missing or pending Vercel status, or a newer unverified `origin/main` SHA also leaves the issue acknowledged. Existing release manifests cannot be overwritten; retain their evidence.
11. CRITICAL clusters keep their own architecture, security, and data gates. Rollback of issues resolved by a verify-release run is `npm run fixerrors -- --reopen --run-id=<id> --apply`.

12. Correct a mistaken mute using the original archived snapshot and mute run, with explicit issue IDs and a sanitised reason. Dry-run first, inspect exactly which issues would be acknowledged, then repeat with `--apply`:

```bash
npm run fixerrors -- --reopen-muted --run-id=<mute-run-id> --snapshot-file=private/fixerrors/snapshots/<snapshot-id>.json --issue-ids=<ids> --evidence="Reason for correcting the mute"
```

   This acknowledges rather than resolves. It verifies the original snapshot and database, unchanged fingerprints/occurrences/last-seen times, and the latest matching mute audit and status event. A newer action or recurrence blocks the entire correction. It records status and admin audit events. Historical corrections do not use export expiry because they undo a precisely identified prior action; they do not authorize unrelated status changes.

## Queue, evidence and bounded operations

The prioritized queue compares only a checksum-verified, same-database, non-newer prior export. Stable work keys include issue ID and fingerprint; changed identities and reset occurrence counts never borrow deltas. New issues, new occurrences/recurrences, overdue reviews, changed evidence and pending releases precede unchanged backlog, which remains visible. Export-start counts are not claimed as post-repair improvements. Queue evidence is archived as `private/fixerrors/snapshots/<snapshot-id>-queue.json`.

Five-minute route/release/browser burst groups are bounded report-only hints: they do not merge issues, suppress alerts or discard explicit reports. Recent fix-subject commits on the fetched production branch are bounded to 50 commits / 30 days and 20 unlinked candidates. Production-branch presence is not deployment or causality proof. Exact fingerprint recurrence can mark a previous fix as failed; similar messages alone cannot. A CRITICAL member always retains its approval gates.

Photo guards capture uploading/recovering/needs-attention/ready and bounded counts at failure time. Upload failures capture preflight/intent/provider-upload/finalize, observed HTTP status and a validated ephemeral request reference through the existing explicit report path. Unknown status stays unknown and is never proof of noise. No diagnostic URLs, bodies, filenames, form values or persistent device IDs are added. See `docs/fixerrors-improvements.md` for collector recipes and the offline benchmark.

Export the following optional environment variables before invoking the command. Each must be a decimal integer from 1 to 600000 milliseconds; invalid settings fail explicitly:

| Variable | Default ms |
|---|---:|
| `FIXERRORS_GIT_TIMEOUT_MS` | 30000 |
| `FIXERRORS_GITHUB_TIMEOUT_MS` | 30000 |
| `FIXERRORS_CONNECT_TIMEOUT_MS` | 15000 |
| `FIXERRORS_QUERY_TIMEOUT_MS` | 60000 |
| `FIXERRORS_STATEMENT_TIMEOUT_MS` | 45000 |
| `FIXERRORS_LOCK_TIMEOUT_MS` | 10000 |

The idle-transaction deadline uses the query timeout. Stage timings and aggregate subprocess/query counts are printed without SQL parameters, connection strings or command arguments. Timeouts fail explicitly, do not retry mutations and do not relax transaction, review or release checks.
