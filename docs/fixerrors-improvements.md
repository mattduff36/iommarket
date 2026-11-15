# Fixerrors: trustworthy, incremental investigation

One codebase serves production and preview. These changes do not resolve historical incidents, suppress unknown failures, authorize a release or alter payment/security gates. The operational workflow remains in `.cursor/commands/fixerrors.md`.

## Decision integrity

- Source candidates carry provenance and confidence. Original frames require a valid positive source line; route/action/compiled-chunk matches remain low-confidence hints.
- CLIENT evidence requires explicit `clientStackProvided=true` before trusting a stack. Older ingest-created server stacks are not browser fault locations.
- Every issue needs its own original frame for auto-repair. A CRITICAL member keeps critical approval gates, including after a failed prior fix.
- The report renders the final history-adjusted disposition and block reason used in `decision.json`. Only exact fingerprints establish a failed-fix recurrence; similar messages are hints.
- Decision v3 binds exact manifest bytes, snapshot ID, issue checksum, complete unique issue membership, baseline and lane. Legacy unbound decisions require re-export for a new repair. Existing snapshot/release verification remains readable.

Checksums are integrity checks, not cryptographic signatures, authentication or independent review.

## Incremental plans and work queue

An investigation manifest covers every snapshot issue exactly once. `action: "retain"` preserves a valid existing plan verbatim, even when overdue, without issue/status/audit writes, date renewal, occurrence-baseline resets or collector/deployment revalidation. `action: "update"` supplies a complete investigated plan; omitted action preserves legacy update behavior.

All issue identities, severities and raw stored-review checksums are checked under row locks before any update. A concurrent occurrence or review rejects the whole batch. Collector source **and test** paths are checked against immutable fetched SHAs. Invocation-local caches deduplicate unchanged local Git hashes and SHA/path lookups; local bytes are reread and Git line-ending/attribute normalization is preserved. A later invocation starts fresh.

Create a local draft without environment loading, GitHub or database access:

```powershell
npm run fixerrors -- --draft-investigations --snapshot-file=<snapshot.json> --output=<new-manifest.json>
```

Existing valid plans become retains; missing plans become deliberately incomplete updates. Add actual findings, evidence, ownership, review date and collector details before recording. The draft is not a fabricated investigation or a ready-to-apply missing plan.

The queue compares checksum-verified, same-database, non-newer exports. Stable issue+fingerprint keys avoid borrowing occurrence counts across identities; reset counts have no inferred delta. New issues, deltas/recurrences, overdue reviews, changed evidence and fingerprint-matched release records precede unchanged backlog. All backlog entries remain visible. Counts describe export-start evidence, not fixes achieved by that run.

Critical incidents and explicit user reports remain at the top of the work queue even when unchanged. Five-minute route/release/browser bursts are bounded report-only hints; no issue merging, alert suppression or explicit-report deletion occurs. Production-branch fix candidates are bounded to 50 commits/30 days and 20 unlinked subjects. Branch membership does not prove deployment or causality. Queue evidence is archived beside each immutable snapshot.

Repairs taking longer than the 30-minute snapshot validity window require a fresh export before committing. Keep one writer in the checkout during verification: a collector configuration is checked once per invocation, not continuously while another process edits it.

## Privacy-safe collector recipes

These are implementation recipes, not findings about particular customers or incidents. New client diagnostics require an approved staging/production release before they can collect production evidence.

| Symptom | Collector and regression evidence | Trigger and expected evidence | Next investigation |
|---|---|---|---|
| Photo-submit guard | `app/(public)/sell/create-listing-form.tsx`; `__tests__/components/create-listing-form.test.tsx` | A blocked submit followed by **Report issue** captures uploading/recovering/needs-attention/ready and bounded counts at failure time, even if state changes before the click. | Separate an active upload from local recovery or user attention; correlate with safe request evidence before assigning cause. |
| Upload failure | `lib/images/client-upload.ts`, `lib/images/imagekit-client-upload.ts`, `components/marketplace/image-upload.tsx`; `__tests__/lib/imagekit-client-upload.test.ts`, `__tests__/components/image-upload.test.tsx` | A failed upload followed by **Report issue** captures preflight/intent/provider-upload/finalize, an observed HTTP status when available and a validated ephemeral `x-request-id`. No added background request or duplicate upload. | Identify the failing phase and correlate the request reference with server evidence. Missing status is unknown, not an HTTP outcome or noise. |
| Report/export chain | `app/api/monitoring/report-issue/route.ts`, `scripts/fixerrors/evidence.ts`; `__tests__/app/api/report-issue-route.test.ts` | Explicit reports pass the strict shared schema and reach exported snapshot evidence. Unknown fields and unsafe values are rejected/dropped. | Use the bounded facts and retained event context; diagnostic availability alone does not prove the incident is fixed. |
| Resource or opaque network failure | Existing `components/monitoring/client-error-listener.tsx`, `lib/monitoring/resource-diagnostics.ts`, `lib/monitoring/request-diagnostics.ts`; `__tests__/lib/monitoring-client-capture.test.tsx`, `__tests__/lib/monitoring-resource-diagnostics.test.ts` | Existing capture records closed resource/request facts. Status zero/absent remains opaque; stale or ambiguous timing is not assigned to a failure. | Correlate route, release, request and nearby server events. Keep generic network/RSC/opaque failures reportable when cause is unknown. |

Diagnostics exclude URLs, filenames, form values, response bodies and persistent device IDs. Existing origin/auth/rate-limit/reporting protections and verified payment webhooks are unchanged.

## Deadlines and timings

Optional process environment settings accept decimal integers from 1 through 600000 milliseconds:

| Setting | Default ms |
|---|---:|
| `FIXERRORS_GIT_TIMEOUT_MS` | 30000 |
| `FIXERRORS_GITHUB_TIMEOUT_MS` | 30000 |
| `FIXERRORS_CONNECT_TIMEOUT_MS` | 15000 |
| `FIXERRORS_QUERY_TIMEOUT_MS` | 60000 |
| `FIXERRORS_STATEMENT_TIMEOUT_MS` | 45000 |
| `FIXERRORS_LOCK_TIMEOUT_MS` | 10000 |

Idle-transaction timeout follows query timeout. Invalid settings/timeouts fail explicitly; mutations are not automatically retried. Per-stage and aggregate timings use stage/command names and SQL operation keywords, never connection strings, SQL values or command arguments. These deadlines bound individual operations, not the total number of archived release checks.

## Reproducible offline benchmark

```powershell
npx tsx scripts\fixerrors\benchmark.ts
```

The script builds and deletes one disposable synthetic Git object tree, without staging/committing, environment loading, database connections, network or deployment operations. It compares repeated source indexing and local/ref hashing against a shared source index and the actual new collector verifier. Both paths assert matching blobs.

Measured on this Windows checkout: 98 synthetic issues, 10 collector configurations, 308 path references, 32 unique collector paths and 333 source files.

| Work | Before | After |
|---|---:|---:|
| Elapsed milliseconds | 107559 | 10973 |
| Git subprocesses | 924 | 96 |
| Source-tree walks | 98 | 1 |

This single final-candidate run was approximately 9.8x faster for the measured operations, including Windows process-launch costs. It is not an end-to-end production export SLA: database/GitHub latency, release reconciliation, retained-plan savings and deployment behavior are not measured. Focused Vitest regressions and TypeScript checks use mocks/synthetic data; production behavior still requires parent-owned review and approved deployment verification.
