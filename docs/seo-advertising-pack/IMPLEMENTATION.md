# Implementation requirements

## Scope and completion levels

Deliver the application work in phases. Distinguish three states for every integration: implemented and tested locally; verified on live preview with test credentials; activated and verified in production. A missing account connection must never be silently reported as complete.

Core scope comprises phases 1 through 5 below. Phase 6 feed activation depends on platform eligibility and account access; implement the reusable export foundation only after the supported contract is established. Do not delay basic SEO fixes for feed approvals.

## Phase 1 Environment indexing and crawl policy

1. Introduce one server-owned environment/indexability policy, reused by robots, sitemap and metadata/response headers. Inspect existing environment helpers before inventing another.
2. Preview deployments, custom preview domains and local/test runtimes must never opt into search indexing. Production public pages may index only when the existing launch policy allows. Do not classify environments from a user-controlled query, cookie or untrusted Host header.
3. Set a reliable preview `X-Robots-Tag: noindex` response header for HTML routes, with metadata as appropriate. Publish no indexable preview sitemap entries. Test custom preview aliases explicitly; do not rely solely on Vercel's default deployment behavior.
4. Choose robots behavior deliberately: crawlers cannot read a page's noindex directive when robots prevents fetching it. If preview URLs may already be indexed, use a crawlable noindex removal phase or a verified search-engine removal process before blanket disallow. Document the chosen sequence. Robots exclusion is not access control.
5. Keep preview navigation and social image fetching usable. Retain existing production launch protections, authentication and private-route security. Define explicit noindex for public utility/auth/payment routes where needed; do not block public inventory accidentally.
6. Production canonicals and sitemap URLs use `https://itrader.im` consistently. Preview canonicals may remain self-referencing under enforced noindex; do not use cross-domain canonicals as the only preview safeguard.
7. Check HTTP/HTTPS and www/apex redirects without creating loops. Verify infrastructure behavior before adding application redirects. Changes to domain/project settings require a concrete explanation and appropriate approval.

## Phase 2 Metadata and sharing

1. Extend existing metadata helpers with clear per-page inputs and defaults. Avoid a large SEO plugin or competing metadata system unless a demonstrated need justifies it.
2. Add a public branded 1200 by 630 social fallback and large-image Twitter card. Reuse verified brand artwork; ensure the image URL resolves anonymously with the correct content type. Add image alt text.
3. Keep listing-specific images; supply a fallback when no valid photo is available. Check that nested Next.js metadata merging does not erase required fields. Retain correctly signed Cloudinary image handling.
4. Add dealer profile social metadata using real dealer name, logo/stock imagery and description, with fallback. Add suitable metadata to homepage, categories, pricing, vehicle checks and public seller/dealer landing pages.
5. Give each active category a relevant title and description. Use actual slugs (`car`, `van`, `motorbike`, `motorhome` at audit time), not guessed plurals. Preserve noindex for invalid categories and arbitrary filter combinations.
6. Generate concise listing descriptions from available make/model/year/price/location facts; avoid blindly truncating imported boilerplate midway through a sentence. Preserve accurate displayed content and do not invent attributes.
7. Preserve established listing URLs. Readable slugs are not a prerequisite; do not introduce a mass URL migration solely for cosmetics.

## Phase 3 Search content and structured data

1. Add concise category introductions, descriptive headings and crawlable internal links. Preserve functional search and mobile layout. Keep the current category URL scheme unless a reviewed migration with redirects is worthwhile.
2. Start with a small allowlist of useful landing pages: vehicle categories, selling a vehicle on the Isle of Man, and dealer advertising. Reuse existing public pages where they serve the intent. Inspect whether existing `/sell` routes require sign-in; marketing pages should be readable anonymously and lead into the protected flow.
3. Add make/model/location landing pages only where live inventory and distinct useful content justify them. Empty/thin combinations must not create an indexable page explosion. No bulk AI doorway pages or fabricated local offices.
4. Include relevant buyer/seller guidance using verified facts. Jurisdiction-specific fees, import, registration or legal claims need authoritative sources and dates. Draft uncertain guidance for review rather than inventing it.
5. Extend existing JSON-LD: consistent Organization/WebSite identity and stable IDs, applicable dealer business identity, and real vehicle condition, make/model, seller and offer URL. Keep Product/Offer and BreadcrumbList working; do not duplicate them. Use vehicle types where semantically valid and distinguish schema validity from Google rich-result eligibility.
6. Structured data must match visible information, price, GBP currency and stock state. Never manufacture reviews, ratings, opening hours or merchant policies. Dealer sellers and iTrader service provider are different entities.
7. Define lifecycle behavior for live, sold, expired, removed, missing and private listings. Preserve useful sold pages with clear availability and links to alternatives where appropriate. Keep genuinely unavailable content as genuine not-found/removed responses; do not redirect every dead listing to the homepage.
8. Remove silent sitemap record caps using stable pagination or sitemap partitions. Include only eligible canonical public URLs, exclude private/sample/preview records according to existing visibility rules, use truthful modification dates or omit unknown dates, and avoid changing timestamps on every fetch. Test partition boundaries and concurrent stock changes.
9. Review crawlable pagination and internal discovery. Do not rely on permanently noindexed pages as the sole discovery path to inventory. Preserve a complete sitemap and actual anchor links.

## Phase 4 Consent and campaign attribution

1. Extend the existing versioned consent model with separate analytics and marketing choices. Default optional providers off. Preserve accept/reject/manage and add withdrawal behavior; an old analytics-only consent must not grant marketing consent.
2. Browser and server delivery must enforce the same consent purpose and policy version. Do not send marketing events merely because they originate on the server. Specify how withdrawal prevents delivery of queued unsent events. Existing strictly necessary operational records need not depend on advertising consent.
3. Update cookie/privacy disclosures to describe actual providers and retention. Do not claim legal compliance solely from implementation; identify policy decisions requiring owner review before live activation.
4. Capture only an allowlist of campaign parameters and supported click identifiers, with validation, length limits and an explicit retention limit. Store attribution only under the appropriate consent. Do not persist arbitrary query strings, message text, registration numbers or other accidental personal data.
5. Preserve current analytics URL sanitisation. Define first and last touch, direct return behavior and checkout continuity without putting personal data in URLs. Browser input is untrusted; never use it to authorise payments or set revenue.
6. Attach permitted attribution to successful business outcomes using opaque identifiers. Reuse existing records where suitable; propose additive schema only when needed. Document retention/cleanup and consent lifecycle for stored data.
7. Add campaign/source reporting that reconciles against real enquiries, registrations and successful service payments. Distinguish site totals from consented/attributable subsets; untracked traffic is unknown, not zero.

## Phase 5 Advertising events and diagnostics

Build a small provider adapter around existing domain events rather than scattering tags across components. Keep Vercel analytics intact. Meta is the first provider; add optional GA4/Google Ads integration when configured, using one coherent integration path to avoid duplicate tags. GTM is optional, not an additional requirement.

| Business outcome | Suggested provider mapping | Authoritative trigger |
| --- | --- | --- |
| Vehicle detail viewed | Meta ViewContent | Public listing rendered/viewed with permitted consent |
| Search | Meta Search or corresponding analytics event | Search actually performed, with safe category attributes only |
| Seller enquiry | Lead or Contact, choose one primary conversion | Successful accepted enquiry, not form/button click |
| Phone/contact link clicked | Separate contact-click event | Click only; never label as a completed call or qualified lead |
| Account created | CompleteRegistration | Successful creation, not sign-up page view |
| Listing submitted | Custom listing-submitted conversion | Accepted submission, not opening the form |
| Checkout started | InitiateCheckout | Valid checkout created |
| iTrader service paid | Purchase and appropriate subscription reporting | Verified payment success, with actual service amount/currency |

1. Never report vehicle asking price as iTrader purchase revenue. Free listings are not purchases. Do not count subscription signup and payment as two purchases for one charge; distinguish recurring renewals deliberately.
2. Use stable event IDs for browser/server deduplication and stable transaction IDs for payments. Reloads, retries, duplicate webhooks and return-tab navigation must not inflate conversions. Domain success is the source of truth, not the thank-you URL.
3. Use durable delivery/retry only where needed, following existing job conventions. Handle rate limits, timeouts and invalid payloads, bound retries, and expose sanitized diagnostics. Advertising provider failure must not fail a payment, enquiry or listing submission.
4. Preserve Ripple signature verification and existing success transitions. If using a transactional outbox, keep the change additive and narrowly scoped. Never alter paid subscription entitlement semantics for tracking.
5. Keep credentials server-side; expose only identifiers required by the browser. Do not log access tokens, raw identifiers or customer data. Hashing alone does not make personal data anonymous. Advanced matching is off unless explicitly reviewed and configured.
6. Separate production and test destinations. Preview must never send to the production advertising dataset by default. Use a dedicated test dataset/account or local mock; a test-event code alone must not be assumed to isolate live measurement. Verify platform behavior.
7. When configuration is absent, render normally without throwing and report integration disabled in internal diagnostics. Production marketing delivery requires an explicit activation flag and validated configuration. Restrict diagnostic screens to authorised admins.
8. Document environment settings in a placeholder-only example and an environment matrix. Suggested concepts are provider enabled, dataset/pixel ID, server token, test destination, analytics measurement ID, ad conversion ID/label and policy version. Resolve exact names against existing conventions; do not duplicate real secrets into the pack.
9. Implement relevant Google consent signals according to current official guidance if Google measurement is enabled. Use a conservative blocked-before-consent default; cookieless pings are not silently authorised by this brief.

## Phase 6 Inventory feeds and account operations

Confirm current Meta vehicle-catalog and Google Vehicle Ads eligibility and required schemas before implementing provider-specific exports. Do not treat this as a generic retail shopping feed.

- Feed IDs must match event content IDs. Export canonical public deep links, accessible real images, actual price/currency/availability and required vehicle/dealer fields.
- Exclude private data, hidden/sample/unapproved/expired stock and unsuitable categories. Separate dealer and private inventory according to platform rules.
- Handle sold removal, price changes, deletion, pagination, caching and safe refresh. Validate required fields and report rejected rows without silently publishing bad inventory.
- Test a fixture feed and controlled preview inventory. Publishing a catalog, scheduling an external import or creating/spending on campaigns requires explicit approval.
- Prepare owner setup steps for Search Console/Bing ownership and sitemap submission; Meta assets/domain/dataset access and test events; GA4/Google Ads conversion setup; and applicable catalog diagnostics. Use available read-only tools before asking the user for information that is already accessible.
- Do not represent account configuration as missing solely because no HTML verification tag exists: DNS verification and external settings may already be in place.

## Performance and delivery decisions

Measure mobile homepage, category/search, dealer and listing pages before and after material changes. Review image sizes/loading, layout stability, third-party script cost and server query latency. Avoid broad redesign or speculative caching that could leak personalised content or stale availability.

Use LCP at or below 2.5 seconds, INP at or below 200 ms and CLS at or below 0.1 as field-performance goals at the 75th percentile, subject to current Google guidance. Lab results are diagnostics, not proof of field INP or a ranking guarantee. Record test conditions and unavailable field data honestly.

Do not add unrelated SEO mechanisms such as mass meta-keywords, fabricated review stars, paid backlink schemes, mandatory FAQ rich results, or an Indexing API integration for ordinary vehicle pages.
