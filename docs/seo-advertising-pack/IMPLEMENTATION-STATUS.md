Branch and base SHA: preview, base a796c3b (same commit as main). Implementation commit is recorded after release.
Scope and decisions:
- One server-owned indexing policy. Preview removal is crawlable noindex with an empty sitemap. Production canonicals stay on the configured production origin. Host, query and cookies do not choose the environment.
- Social fallback is the existing 1200x630 brand image at /og/itrader-social.png.
- Category landing copy uses the live slugs car, van, motorbike and motorhome. No make/model doorway pages.
- Public pages /sell-on-the-isle-of-man and /dealer-advertising are anonymous. /sell remains the signed-in flow.
- Cookie policy version is 2026-10-03.1. Marketing defaults off. Old analytics-only consent does not grant marketing. This is not a legal sign-off.
- Advertising delivery is off without credentials. Live delivery cannot run on preview. Purchase value comes from a succeeded service payment or subscription charge, never the vehicle asking price. Browser clients cannot submit Purchase.
- No inventory feed. Isle of Man Vehicle Ads and Meta catalog eligibility were not confirmed, so no export or publication was built.
- No database migration is applied. PROPOSED-ATTRIBUTION.sql is a proposal only.
Phase status: locally verified. Preview verification is next. Production approval is not requested.
Changed files: SEO policy, metadata, sitemap, consent, advertising adapter, two landing pages, cookie policy, admin diagnostics, tests, this status file.
Tests and evidence: `npx tsc --noEmit` passed. Focused vitest passed for indexing, robots, sitemap, search metadata, dealer metadata, consent, advertising destination, purchase claim, sitemap partitions and hosted payment return. Launch-closed tests now freeze the clock before 10:00 BST on 3 October 2026, because the public launch instant has passed. Cookie policy version 2026-10-03.1 is accepted by the policy corpus test. `npm run finalise:full:push` is the release check.
Review findings and resolution: independent review found purchase delivery was only idempotent inside one process, and GA4 did not receive a purchase transaction id. Fixed by claiming `ad-purchase:{transactionId}` in Upstash when configured (fail closed if that claim errors) and sending GA4 event name `purchase` with `transaction_id`. Indexing, consent, payment entitlement and release configuration had no significant findings. Live provider receipt is not claimed.
Environment configuration: names in ENVIRONMENT.md. No secrets committed. Delivery is off until test or live credentials are set in the host.
Migrations: proposed, not approved, not applied. No shared database target was changed.
External dependencies and exact next action: Meta test dataset, pixel and CAPI token; optional GA4 test measurement id and API secret; optional Google Ads test id and label. Search Console, Bing, Meta Business and Google Ads account access were not available. Vehicle catalog publication stays blocked. Field Core Web Vitals were not measured.
Preview commit, deployment and alias: not released yet.
Production proposal and approval state: not requested. Do not merge, enable live tracking, publish a catalog or spend.
Rollback reference: disable ADVERTISING_DELIVERY first. Redeploy the previous preview deployment if the application change must be removed. Do not drop data; no advertising table was created.
