# Fixerrors audit — 8 October 2026

## Release verification

The fixes were committed as `e40eec5` on staging: typechecking passed, 548 test files passed with one skipped, and 3,106 tests passed with six skipped. Exact-head staging acceptance reproduced the former search failure before deployment and verified 33 results afterward, correct legacy-unit conversion, loaded dealer logos and a fresh upload preview.

Owner-approved PR #31 merged as `f9a5849` and is live in production. Production numeric search returned 36 results; subsequent ImageKit activation and authenticated upload acceptance are recorded in `docs/imagekit-production-readiness.md`. No monitoring issue was automatically marked resolved merely because the release deployed. Payment-inbox events without safe product/customer references and opaque events lacking correlation evidence remain separate investigation items.

## Observed run

Cursor ran the production `/fixerrors` workflow on the shared `staging` branch. It inspected 40 open issues in 28 patterns and 16 clusters. The first pass took 903,596 ms (15 minutes 4 seconds) and 131 completed tool calls. Routing was `Auto`; the underlying model and billed cost were unavailable. Runtime counters reported 346,170 input tokens, 42,888 output tokens and 4,791,808 cache-read tokens; these are not unique context size or a cost calculation.

The run correctly refused an unreviewed commit, did not deploy, and resolved no issues. Independent review caught an incomplete numeric SQL repair, overly broad browser-error suppression, and a test that loaded production credentials during ordinary test execution. Those were corrected before release.

Six unjustified opaque-error mutes were reversed through the new audited correction mode. A read-only production check at 23:30 UTC on 7 October confirmed **32 acknowledged, eight muted, zero resolved** across the original snapshot. Status triage is not proof that a fault is fixed.

## Automation changes

- Commit checks reject unrelated staged files and bind independent reviewer identity/evidence to the exact reviewed diff hash. Both dry-run and apply verify the staged content. Apply uses an isolated index snapshot, preserving unrelated files staged concurrently in the real index. Concurrent commits remain unsupported and a detected HEAD change stops the operation.
- Production verification checks the reviewed source blobs, not only commit ancestry, so a reverted fix cannot silently qualify for resolution.
- Reviews may identify only the repaired subset of a mixed cluster. Existing release evidence cannot be overwritten.
- Stack extraction handles separate lines and Next.js route-group parentheses. Additional existing callers are checked against snapshot-bound Git commits; genuinely new helpers/tests require explicit declaration and reviewed content.
- Event exports limit retained events in SQL, and history lookup indexes fingerprints instead of repeatedly scanning the log.
- Classification recognizes underscore-separated payment settings and missing-relation database errors.
- `--reopen-muted` supports a dry-run and audited correction of an unchanged mute from an exact original run. It checks the original snapshot/database, issue identity and latest matching audit/status events.
- Workflow instructions require bounded searches, reuse of unchanged file reads, meaningful regression tests, current evidence for historical configuration claims and explicit opt-in database integration tests.

## Application repairs

Numeric search uses the real Prisma table names and guarded numeric conversion. Both entry points preserve decimal filter input and marketplace visibility. Malformed stored values cannot abort a search. Regression checks include actual PostgreSQL execution in an isolated local cluster; normal tests do not load production credentials.

New filter URLs carry `numericFilterUnits=v1` for litres/hours. Old integer URL bounds convert from tenths/minutes, and charging-time slider values round-trip with six-decimal hour precision. Historical seed values use inconsistent scales; no persisted customer/demo data were reinterpreted or rewritten without provenance.

Account synchronization retries only when the exact authenticated identity was concurrently created; it never links accounts by email. Dealer onboarding retries a narrowly identified subscription uniqueness race and recomputes entitlement. Invoice requests select only the fields needed to freeze invoice lines and use a bounded longer transaction timeout; email delivery remains outside the transaction.

Browser-noise capture/classification matches specific observed extension/bridge messages and retains opaque `Script error` reports.

## Remaining evidence limits

React error 441 is a production Server Components error wrapper, not a diagnosis. Match its digest to server evidence before choosing a repair; see the [official React error-code registry](https://github.com/facebook/react/blob/main/scripts/error-codes/codes.json).

The follow-up matched 33 search client reports to 18 numeric-search server events using digest, route and a two-minute time window. Four sell-page client reports matched one account-creation server event. The home/signup reports lacked enough correlation evidence. Reports now retain only allowlisted digest/trace identifiers, not arbitrary event tags.

Read-only payment-inbox inspection found eight quarantined unknown-product events, one ambiguous-dealer failure and one missing-reference failure. Available records do not establish a safe customer/product mapping; no payment replay or entitlement mutation was attempted. The current map-worker asset returned HTTP 200 and the avatar bucket exists, so historical configuration errors alone do not justify changing either configuration.

Historical payment errors with missing references, unknown products or ambiguous dealers must remain fail-closed unless provider/inbox evidence establishes a safe mapping. The stored account-conflict events lack identity information sufficient to retrospectively prove a same-identity race. A successful local test or acknowledgement does not justify resolving these issues.

Production resolution remains gated on a reviewed staging-to-main release, verified deployed content and absence of post-deployment recurrence. Private run logs and per-issue evidence remain in the ignored `private/automation/fixerrors-audit-20261007` directory.
