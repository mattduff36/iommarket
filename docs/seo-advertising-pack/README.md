# iTrader SEO and advertising implementation pack

This pack turns the 3 October 2026 code and HTTP audit into an implementation brief for Cursor. Build and verify on the preview branch, deploy to live preview, then prepare a reviewed release into main. Production promotion is a separate approval step.

## Start here

Paste `CURSOR-PROMPT.md` into Cursor with this repository open. Read `IMPLEMENTATION.md` for scope and decisions, and `VALIDATION-AND-RELEASE.md` for acceptance and release gates. Cursor should maintain `IMPLEMENTATION-STATUS.md` as it works, recording evidence and unresolved dependencies rather than marking untested items complete.

The pack itself does not change application behavior, provision accounts, install tracking, migrate databases, push branches or deploy anything. At authoring, the working checkout was on `main`; Cursor must establish the correct preview checkout before implementation. These files are initially local and uncommitted; preserve them when preparing that checkout.

## Audit baseline

Recheck this baseline before changing code; it is a point-in-time observation, not a statement about future deployments.

| Area | Observed evidence | Implication |
| --- | --- | --- |
| Production crawlability | `https://itrader.im/robots.txt` and `/sitemap.xml` returned 200; robots allowed public crawling | Preserve production indexing after launch |
| Preview indexing | Preview homepage and robots returned 200; robots allowed crawling, canonical pointed to preview, no homepage noindex header/meta | Prioritise explicit environment indexing protection |
| Sitemap | 153 URLs in the sampled production sitemap; source caps listings/dealers at 2,000 each | Fix completeness before stock exceeds the cap |
| Category metadata | `/search?category=car` was indexable and self-canonical, but titled `Search \| itrader.im` | Add category-specific metadata and useful content |
| Invalid filters | `/search?category=cars` was noindex and canonicalised to `/search` | Preserve deliberate filter handling; actual car slug is `car` |
| Social previews | Homepage lacked `og:image`; sampled listing had a 1200 by 630 image that returned 200 JPEG | Extend working listing support with defaults and dealer cards |
| Structured data | Sampled listing emitted Product/Offer AND BreadcrumbList | Extend these; do not add duplicate breadcrumb markup |
| Measurement | Vercel analytics, marketplace event hooks and business funnel exist | Reuse them; missing advertising integration is not missing all analytics |
| Advertising | No Meta Pixel/CAPI, dedicated campaign persistence or ad feed found in audited application code | Add an optional, consent-aware integration layer |
| Unavailable listings | Detail route calls `notFound()` for inaccessible records | Test rendered HTTP/meta behavior before claiming missing noindex |

## Relevant existing files

- Governance: `AGENTS.md`, `.cursor/rules/00-core.mdc`, `.cursor/rules/finalise.mdc`, applicable coding/security/testing rules, `docs/preview-payment-simulator.md`.
- Metadata and indexing: `app/layout.tsx`, `app/robots.ts`, `app/sitemap.ts`, `lib/launch/public-metadata.ts`, `lib/launch/gate.ts`, `proxy.ts`, `lib/seo/structured-data.ts`, `lib/search/search-url.ts`.
- Public pages: `app/(public)/page.tsx`, `app/(public)/search/page.tsx`, `app/(public)/categories/[slug]/page.tsx`, `app/(public)/listings/[id]/page.tsx`, `app/(public)/dealers/[slug]/page.tsx`.
- Tracking and consent: `components/layout/consented-analytics.tsx`, `components/layout/cookie-banner.tsx`, `lib/consent/cookie-consent.ts`, `lib/analytics/events.ts`, `lib/analytics/privacy.ts`, `lib/analytics/track-client.ts`, `lib/analytics/business-funnel.ts`.
- Payment event example: `components/payments/hosted-payment-confirmation.tsx`. Trace actual authoritative success transitions before adding server conversions.
- Existing tests: `__tests__/app/robots.test.ts`, `__tests__/app/sitemap.test.ts`, `__tests__/app/search-metadata.test.ts`, `__tests__/app/static-canonical-metadata.test.ts`, `__tests__/lib/analytics-events.test.ts`.
- Existing artwork: `brand-assets/og/`, `brand-renderer/output/meta/`. Inspect and reuse suitable assets; their existence does not mean they are publicly served.

## External guidance

Recheck current official documentation when implementing platform-specific integrations. The audit did not verify access to Search Console, Bing, Meta or Google Ads accounts, and did not measure field Core Web Vitals.

- Google faceted navigation: https://developers.google.com/crawling/docs/faceted-navigation
- Google Product structured data: https://developers.google.com/search/docs/appearance/structured-data/product
- Google Core Web Vitals reporting: https://support.google.com/webmasters/answer/9205520
- Google Vehicle Ads eligibility: https://support.google.com/google-ads/answer/11189169
- Meta measurement overview: https://www.facebookblueprint.com/student/path/253183-signals-data-sources-course
- Meta CAPI event deduplication: https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events/

Vehicle Ads eligibility is conditional: verify Isle of Man targeting/account eligibility explicitly, supported inventory types, and dealer versus private stock. Do not assume UK availability includes the Isle of Man. Product markup does not guarantee shopping eligibility or rich results.
