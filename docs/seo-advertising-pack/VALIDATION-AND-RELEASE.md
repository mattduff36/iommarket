# Validation and release

## Acceptance matrix

Record actual commands, results, URLs and environment in the status file. Use fixtures for destructive or payment-related scenarios. Do not send real enquiries, emails or payments merely to prove tracking.

| Area | Required evidence |
| --- | --- |
| Environment rules | Tests cover production open/gated, preview alias/deployment, local and missing/invalid configuration; unknown environments cannot enable marketing delivery or indexing accidentally |
| Preview indexing | Anonymous live preview HTML has effective noindex; sitemap advertises no indexable preview content; documented robots/removal sequence; preview still usable |
| Production safety | Production-mode automated checks prove eligible public pages remain indexable and canonicals use production; no branch-name-only behavior |
| Metadata | Home, each category, dealer, listing with photo and listing without photo have correct title/description/canonical and resolved social image |
| Social fetch | Images return successful anonymous responses with correct MIME and dimensions; use Meta Sharing Debugger when accessible; ordinary HTTP fetch alone is not Facebook crawler verification |
| Filters | Base/category pages follow chosen indexing policy; invalid categories, sorting, search terms, filters and pagination preserve intended canonicals/noindex |
| Sitemap | Eligible inventory beyond 2,000 included; partition boundaries have no omissions/duplicates; hidden/private stock excluded; timestamps truthful |
| Lifecycle | Live/sold/expired/removed/private/missing fixtures have intended status, indexability, offer availability and alternatives; inspect rendered result, not metadata helper alone |
| Schema | No duplicate JSON-LD; safe escaping of user content; visible facts match markup; validate supported rich results and schema semantics separately |
| Consent | Fresh/accept/reject/manage/withdraw/old-version cases; no optional provider requests before required consent; server retries respect revocation |
| Attribution | Allowlist/limits/retention/first-last touch/return visits verified; no PII leakage; consent-denied journeys still work |
| Events | Correct triggers and IDs; browser plus server counted once; refresh/retry/duplicate webhook do not double-count; actual payment amount used |
| Isolation | Preview cannot reach production advertising destinations under tested config errors; missing credentials disable providers gracefully |
| Reliability | Provider failure does not break checkout/contact/listing; retries and diagnostics are bounded and sanitized |
| Feeds if included | Required fields, stable IDs, image access, eligibility filters, sold removal and update behavior tested; no real publication without approval |
| User journeys | Anonymous browse/search/detail/dealer, contact, sign-up, selling and preview test checkout still work across mobile and desktop |
| Performance | Before/after measurements with comparable conditions; no unexplained material regression from tags, images or database work |

Start with focused unit/integration tests for changed policy and event code, then affected browser journeys. Reuse existing tests and fixtures. Avoid testing only implementation details. Run the registered release checks once the scope is ready; repeat only when changes/failures justify it.

## Preview release

1. Check current branch, working tree, remote tracking and applicable instructions. Preserve the pack if moving from main to preview. Reconcile remote state safely; never force-push or reset local work.
2. Review changed files and migrations. Inspect whether preview already includes unrelated work. Do not silently include it in the production proposal.
3. Get independent review of environment indexing, consent, event idempotency, payment boundaries and release configuration. Resolve significant findings.
4. Prepare required environment settings with test destinations. Request missing credentials through appropriate secure configuration, not chat or committed files. Independently executable SEO changes may ship with integrations disabled.
5. If a migration is needed, prepare additive SQL and evidence, verify the intended isolated preview database, and obtain approval before applying. Do not use database reset, clone or schema push as a shortcut. Migration is not a finalise step.
6. When authorised by the pasted prompt, announce preview branch/scope and run `npm run finalise:full:push`. Follow `.cursor/rules/finalise.mdc` and the registered repair process. Do not handcraft a substitute release sequence to bypass failed checks.
7. Monitor the process to completion. Record commit SHA, GitHub checks and Vercel deployment status. Confirm `preview.itrader.im` resolves to that deployment and anonymously renders iTrader rather than a protection/login screen.
8. Run live preview acceptance checks. Use a test advertising destination and prove event receipt/deduplication in provider diagnostics when credentials exist. Otherwise mark that item pending, not passed.
9. Produce a concise release report with implemented/verified/disabled/pending states, bugs, exact URLs and next owner decisions.

## Production proposal

Prepare a merge request/report only after preview validation. Review the complete `main...preview` change set, not just the latest commit. If it contains unrelated changes, identify them and propose an isolated promotion strategy for approval.

Before requesting merge approval, supply:

- Exact candidate commit and complete scope, independent review and completed required checks.
- Preview deployment URL and evidence for SEO, consent and real user journeys.
- Production environment changes, with secret values omitted; live provider activation remains off until approved and validated.
- Any migration SQL, target identity, backup/recovery plan and compatibility requirements. Separate approval/application from merge and finalise.
- Pending external account decisions and whether disabled integrations allow safe release of the completed SEO work.
- Rollback steps for application code/configuration, advertising delivery and schema compatibility.

Do not merge while required checks are pending. New commits invalidate approval/check evidence where applicable; reassess the actual release head. A successful build alone is not production verification.

## After production approval

Merge only the approved scope using the repository workflow. Apply only separately authorised migrations/configuration in the documented order. Monitor Vercel until ready; verify the production aliases and user-facing behavior at the released SHA.

Check production robots, sitemap, canonical host, social images and representative listing/dealer/category pages. Confirm preview remains noindex after the same code reaches main. Verify logs and real user journeys. Activate live measurement only when approved and confirm provider receipt using authorised test methods that do not pollute revenue reporting.

Submit or refresh sitemaps and inspect search-engine indexing when account access/authorization permits. Report indexing as observed over time; deployment does not imply immediate ranking or indexing.

## Rollback

Disable affected advertising providers first if they leak data, duplicate conversions or break journeys. Roll back to the last verified application deployment/configuration if necessary. Keep preview noindex protection in place and preserve production indexing. Never reverse additive schema by dropping data automatically; prefer backward-compatible code and an explicitly reviewed recovery plan.

## Status file template

Create `IMPLEMENTATION-STATUS.md` when starting implementation and keep it concise:

```text
Branch and base SHA:
Scope and decisions:
Phase status: not started / implementing / locally verified / preview verified / blocked
Changed files:
Tests and evidence:
Review findings and resolution:
Environment configuration: names and readiness only, no secrets
Migrations: proposed / approved / applied, target and evidence
External dependencies and exact next action:
Preview commit, deployment and alias:
Production proposal and approval state:
Rollback reference:
```
