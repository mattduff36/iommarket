# Staging transition review

Review date: 3 October 2026. Baseline: preview f1bb608, application change 57f8997, production origin/main a796c3b. This document records evidence and intended boundaries; deployment status is recorded separately after validation.

## SEO and advertising review

Live HTTP checks confirmed preview noindex headers, crawlable robots without a sitemap directive, a 404 sitemap, self-referencing preview canonicals, and the car category title. Production was still indexable. Vercel showed both reported preview deployments READY and production on a796c3b. A browser inspection confirmed the homepage and cookie preferences render, with no public inventory cards. A live listing detail journey remains unverified.

The advertising layer was not ready for activation despite passing the previous tests:

- Without Redis, purchase claim and event delivery used the same key, suppressing every purchase.
- Claims occurred before HTTP success, making failed delivery non-retryable; durable cross-instance retry remains unimplemented.
- Purchases originated only from the buyer's return page, missing paid transactions with no return visit.
- Initial denied consent installed a no-op Meta function which prevented later queue initialisation.
- Deterministic per-session event IDs suppressed legitimate repeat searches/enquiries.
- Meta website matching fields, real GA4 browser/session identity and Google Ads conversion delivery were incomplete. Provider HTTP success is not evidence of correctly attributed events.

Local repairs correct claim-key collision, in-process provider retry, fresh logical action IDs and delayed-consent initialisation. Live advertising is explicitly blocked pending durable consent/payment reporting and provider validation. These repairs do not complete the advertising pack. No credentials or live tracking activation are authorised by this review.

## Branch and deployment policy

`staging` is the canonical development branch; `main` is production and accepts approved pull requests from staging. No direct push to main is permitted by default. An exceptional user request requires an explicitly reviewed emergency procedure, not an automatic bypass flag. Feature work may use temporary branches but must reach and be verified on staging before production.

Create staging from the current preview tip, retain preview as historical rollback context, and bind `preview.itrader.im` to staging after validation. The hostname can remain preview.itrader.im without renaming the branch to preview. Preserve production's branch binding to main. Move applicable branch-scoped Vercel settings to staging without changing their values; explicitly set the staging deployment role. Do not print secrets.

GitHub main protection now requires pull requests and a successful `validate` check, includes administrators, and disables force pushes/deletion. Repository release helpers and a local pre-push hook provide additional protection; they do not replace GitHub enforcement. The Quality workflow will validate staging changes and require staging as the production PR source.

## Access and feature ownership

| Feature | Production | Staging |
| --- | --- | --- |
| Public marketplace | Public, existing account permissions | Administrator sign-in required before app access |
| Search indexing | Eligible public content indexable | Noindex, including gate |
| Dealer preview packs | No frontend, admin, media, or statistics visibility | Administrators can browse and manage them; public visitors cannot |
| Checklist | No route/action access or writes | Canonical development checklist |
| Database management | No access | Administrator-only preflight and separately guarded maintenance |
| Monitoring ingestion | Production database only | Staging database only |
| Future combined monitoring view | Own environment | Separate labelled views; production access read-only |
| Advertising | Disabled until validated and explicitly activated | Dedicated test destinations only |

The access gate uses a verified Supabase identity and active ADMIN role from the development database. A legacy shared password, launch cookie, mere login, request hostname or branch name cannot grant access. Signed payment/auth machine hooks retain their independent authentication. Anonymous cron access is not exempted by the staging gate. Before a database refresh, all imported jobs and external side effects need an explicit policy.

Dealer preview packs are a verified-staging feature. Production frontend and admin surfaces treat preview-pack dealers, synthetic preview users, `ADMIN_PREVIEW` listings, listings still linked by `previewPackId`, and their related activity as nonexistent, including for administrators. Management routes stay disabled in production. This boundary uses the verified staging runtime identity, not the git branch name, and it does not delete historical rows. The checklist is a `SiteSetting` key (`admin_checklist`), not a dedicated table. Retain the production value recoverably until the staging checklist has been reconciled; removing the production copy requires an explicit backed-up data change.

## Database observations

Read-only transactions returned these point-in-time counts. No rows or credentials were printed and neither database was changed.

| Entity | Development | Production |
| --- | ---: | ---: |
| Application users | 73 | 49 |
| Supabase Auth users | 4 | 17 |
| Dealer profiles | 48 | 40 |
| Listings | 734 | 689 |
| Dealer preview packs | 35 | 34 |
| Payments | 300 | 0 |
| Subscriptions | 13 | 6 |
| Monitoring issues | 36 | 36 |
| Checklist settings | 1 | 1 |

Equal monitoring counts do not prove equal records. Application profiles and Auth identities are different datasets and cannot be matched by row count. Development has real/test payment history which must not be replayed or destroyed casually.

The user selected separate Replace and Merge actions. Replace means a production snapshot for explicitly approved shared business tables, with protected development state restored; it cannot be a byte-for-byte clone of every schema while also preserving development-only records. Merge retains development-only records and requires reviewed handling for identity/unique-key conflicts. Both modes must report exact scope, inserts/updates/deletes and exclusions before writing.

The old preview-to-production prod-mirror commands (restore, storage copy, waitlist copy, URL rewrite and verify) have been removed. Shared connection helpers and the `pmr-` backup producer remain for maintenance scripts. Database cloning now runs only from production read to development write through `/admin/database`. See DATABASE-SYNC.md.

## Other datasets requiring review

- Supabase Auth, sessions, MFA and recovery tokens: preserve development administrator access; never copy live sessions or active recovery credentials.
- Supabase Storage and Cloudinary references: verify image access and prevent staging cleanup jobs deleting shared live assets.
- Payments, subscriptions, webhook inboxes and simulator checkouts: preserve legitimate test history, prevent copied provider IDs triggering real billing or entitlement changes.
- Email, onboarding, waitlist and alert queues: never replay pending production deliveries from development.
- Site settings: preserve development checklist, sample visibility and notification destinations; selectively copy business configuration only.
- Audit, monitoring, deletion/retention jobs and rate limits: keep environment-local, never import executable production jobs.
- Cost ledger: already has a canonical reader/writer architecture; retain its ownership rather than duplicating financial facts.
- Policy acceptance, reviews, favourites and searches: define relational dependencies and personal-data scope before cloning.

## Monitoring recommendation

Keep separate databases and retention/alert pipelines. Add a read-only production summary endpoint or narrowly scoped reader for a staging monitoring dashboard with explicit Production and Staging tabs. Fetching production monitoring must not call existing page functions that expire muted issues or write state. Keep resolve/mute/retry actions restricted to the selected local environment; production actions remain in production. A failure to read production must display unavailable, not an empty healthy state.

Do not include monitoring data in routine Replace/Merge. Show environment, deployment SHA, capture health and last event time independently so testing noise cannot hide live failures.
