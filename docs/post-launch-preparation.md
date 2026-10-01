# Follow-up preparation after launch verification

This is a preparation backlog, not authorization to change DNS, enable MFA, purchase services or undertake a broad rewrite. Complete the launch payment/access checks first.

## Performance audit

Capture production and preview baselines for home, search/category results, listing details, dealer profiles, account listings and admin users. Use representative mobile and desktop sessions, signed-in and signed-out. Record LCP, INP, CLS, response time, transferred JavaScript/images, query count and slow database queries before selecting changes.

Investigate image sizes and priority loading, initial client bundles, repeated server reads, pagination, search query plans and cache boundaries. Include the launch five-second account update endpoint: measure request volume and aggregate-query cost with realistic listing counts. It polls only visible relevant pages and returns an opaque version; assess a private push mechanism if that traffic becomes material. Preserve authorization and fresh payment/membership state when considering caching.

Choose fixes from measured bottlenecks. Compare before/after results under the same conditions, including checkout, moderation and owner views. Avoid dependency upgrades or global component rewrites without a demonstrated need.

The launch verification build completed compilation in 2.3 minutes locally. It
reported broad filesystem tracing in `lib/preview-packs/archive.ts` and
`scripts/dealer-stock-sync/archive/paths.ts`, matching roughly 39,000–56,000 paths.
Investigate narrower archive roots and tracing boundaries in the performance
audit; these warnings do not measure production page speed.

The build also exposed an admin filter importing database-dependent helpers into
browser code. Its shared filter values now live in a dependency-free module.
Keep browser-shared types and constants separate from database/query modules as
new components are added.

## Cloudflare preparation

Inventory current DNS records and the authoritative DNS provider first. Export the full zone, including mail, domain verification, Supabase/Resend and Vercel records. Identify account ownership, billing and access needs; the user completes account authentication.

Before any cutover, agree whether the intended change is DNS hosting only or also a proxy/security service. Verify current official Vercel/Cloudflare guidance for that choice. Prepare exact DNS changes, certificate validation, webhook/return-page checks, cache exclusions for authenticated/API/payment pages and a rollback plan. Do not change nameservers as part of the launch UI release.

## Two-factor authentication preparation

Review the existing Supabase authentication flow and current MFA support/documentation before designing enrollment. Start with administrators, with an explicit decision on optional versus mandatory use for other members. Define enrollment, challenge, recovery, lost-device support and administrator recovery controls.

Enforce the required authentication assurance on the server for sensitive actions as well as in navigation. Plan tests for old sessions, new devices, password reset, recovery, disabled users and sensitive-action authorization. Keep payment webhooks independent of interactive MFA. Do not enable mandatory MFA before recovery and support workflows are proven.

## Broader admin workflow testing

Extend the focused launch tests into an action inventory: role changes, free grants/revocation, paid entitlement coexistence, disable/restore, dealer verification, listing approve/reject/take-down/resubmit/expire, Featured purchase/refund, subscription changes, profile addresses and checklist environment guards.

For each action record preconditions, actor permissions, database outcome, owner view, anonymous buyer view, notification outcome, cross-device update and rollback/retry behaviour. Include failed notifications after successful mutations and concurrent actions. Use isolated synthetic fixtures; exclude the real £1 weekly renewal account from destructive tests. Unit/component passes alone do not prove provider delivery or a cross-device browser workflow.
