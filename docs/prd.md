# iTrader.im MVP Product Requirements Document

## 1) Problem, Mission, Positioning

iTrader.im solves the lack of a structured, trustworthy marketplace for high-value local items on the Isle of Man, starting with vehicles. Existing options are cluttered, low-trust, and weak on filtering.

- **Mission**: deliver a premium-feeling, local-first marketplace that is simple, trusted, and effective.
- **Positioning**: professional and premium (not startup-y), minimal motion, clarity-first UX.
- **MVP geography**: Isle of Man only, with default region scope set to the whole Isle of Man.

## 2) Personas

- **Private seller**: wants low-friction listing flow, clear pricing, fast publishing, and renewals.
- **Dealer**: wants subscription-based posting, profile branding, and ongoing listing management.
- **Buyer**: wants fast search/filtering, confidence/trust cues, and easy seller contact without account creation.
- **Admin/moderator**: needs queue-based moderation, reporting workflow, and listing controls.

## 3) Scope: MVP vs Post-MVP

### MVP (must-have)

- Vehicle marketplace (cars, vans, motorbikes).
- Homepage with dominant search, featured listings, subtle dealer spotlight, trust stats, SEO content block.
- Search results with:
  - grid default
  - optional grid/list toggle
  - infinite scroll
  - sticky filters
  - URL-persistent filter state
  - crawlable filter URLs and canonical strategy
- Listing detail with large gallery + thumbnails, sticky contact/price area, spec table, expandable description, similar listings, share actions.
- Seller wizard with:
  - step-based flow
  - photo guidance
  - min 2 / max 20 photos
  - preview before publish
  - create draft, submit for moderation, live for 30 days when approved
- Monetisation:
  - first month free for all listings
  - paid private listings after free window
  - dealer subscriptions
  - featured listing upsell
- Buyer tools:
  - favourites (account required)
  - saved searches (account required)
  - contact seller without account
- Admin moderation:
  - approve/takedown queue
  - report handling
  - dealer verification visibility
  - feature toggle support
- Trust/legal:
  - terms, privacy, cookies pages
  - buyer safety guidance
  - cookie consent banner

### Post-MVP (explicitly future)

- Saved filter presets and price-drop alerts.
- 360 image support, recently viewed, price history chart.
- Map view and finance teaser/integration.
- Multi-region rollout beyond Isle of Man.
- Mobile apps.
- Dealer ratings and bulk upload.

## 4) User Journeys

### A) Browse/Search Listings

1. User lands on homepage.
2. User searches by category/make/model/price and optional advanced filters.
3. User reaches results page in grid by default.
4. User scrolls for more results (infinite scroll), toggles list/grid if desired.
5. URL remains shareable and crawlable.

### B) View Listing Detail

1. User opens listing page.
2. User views gallery, specs, and seller context.
3. User uses share actions and checks similar listings.
4. User contacts seller without signing in.

### C) Favourite + Saved Search

1. Authenticated user favorites listing from results/detail.
2. User saves current search filter state.
3. User returns to profile area and re-runs saved search quickly.

### D) Contact Seller (No Account)

1. Buyer opens contact form on listing.
2. Submits name/email/message with anti-spam checks.
3. Platform sends transactional email to seller and confirmation to buyer.

### E) Create Listing Wizard (Private)

1. User starts `/sell`.
2. Completes step-based form + attributes.
3. Uploads 2-20 photos with guidance.
4. Reviews preview.
5. Submits listing:
   - if free window active: moves to moderation submission
   - else: checkout payment required before moderation submission

### F) Dealer Flow

1. Dealer creates/uses account and profile.
2. Dealer purchases subscription via Stripe Checkout.
3. Active subscription unlocks dealer posting capability.
4. Dealer profile page displays branding and current inventory.

### G) Admin Moderation

1. Admin views pending queue.
2. Approves/takes down listings and can feature where applicable.
3. Reviews reports, updates report status, leaves notes.
4. Dealer verification flag is visible.

## 5) Functional Requirements by Area

### Homepage

- Brand + search-first hero.
- Featured listing section.
- Subtle dealer spotlight area.
- Live marketplace trust stats.
- SEO-friendly descriptive content block.

### Search + Filters + Results

- Supports required filters from questionnaire including:
  - price/year/mileage/body type/colour/fuel/transmission/drive type/seats
  - battery range, engine size, acceleration, fuel consumption, CO2
  - tax per year (Isle of Man context), insurance group
  - seller type
  - location attribute (Isle of Man or UK)
  - keyword
- Filter state reflected in URLs.
- URL strategy supports crawlability and canonical normalization.
- Results show featured style subtly.

### Listing Detail

- Gallery with primary image + thumbs.
- Sticky contact + pricing area.
- Expandable description and structured specs.
- Similar listing suggestions.
- Share actions.

### Seller Wizard

- Multi-step with validation per step.
- Photo constraints: min 2, max 20.
- Preview step mandatory before publish.
- Submission creates moderation candidate.
- Live listings expire at 30 days; renewal flow available.

### Dealer

- Subscription-required posting control.
- Dealer profile branding and listing display.
- Basic dealer dashboard metrics.
- Verification badge support.

### Monetisation

- Configurable first-month free window.
- Paid private listings after free window.
- Dealer recurring subscriptions.
- Featured upsell purchase path.

### Trust / Legal

- Public terms/privacy/cookies pages.
- Fraud report form.
- Buyer safety guidance linked site-wide.
- Cookie consent capture.

## 6) Non-Functional Requirements

### SEO

- Crawlable filter URLs with canonical normalization.
- Listing/detail/category pages include canonical.
- Include `robots.txt` and sitemap generation.
- Avoid duplicate index bloat from equivalent filter combinations.

### Performance

- Optimized image delivery and reasonable sizing.
- Server-render first page of search for crawlability, then incremental load.
- Cache safe read-heavy queries where possible.

### Security

- Zod validation for write paths.
- Rate limiting + spam controls for public submissions.
- Role-gated admin operations.
- Webhook signature verification and idempotency.

### Accessibility

- Semantic labels for controls/forms.
- Keyboard usable filter/search and wizard actions.
- Contrast and focus states preserved.

## 7) Data Model (Prisma)

### Existing core models

- `User`, `DealerProfile`, `Region`, `Category`, `AttributeDefinition`
- `Listing`, `ListingImage`, `ListingAttributeValue`
- `Payment`, `Subscription`, `Report`

### Required additions/changes

- Add `Favourite` model (`userId`, `listingId`, timestamps, unique pair).
- Add `SavedSearch` model (`userId`, `name`, `queryParamsJson`).
- Add listing analytics model/counter (for basic view counts).
- Add optional report workflow fields if needed for admin notes lifecycle.
- Ensure listing publish/renew logic references free-window config.

## 8) Integrations / Services

- **Database**: Postgres (Supabase Postgres compatible).
- **Auth**: Supabase Auth.
- **Image**: Cloudinary + `publicId` persistence and deletion hooks.
- **Payments**: Stripe Checkout + subscriptions + webhooks + idempotency.
- **Email**: Resend for contact/report confirmations.
- **Analytics**: Vercel Analytics baseline events.
- **Error Monitoring**: optional Sentry (minimal MVP setup).
- **Moderation**: in-app admin dashboard tooling.

## 9) Acceptance Criteria (Testable)

- Search supports required filters and persistent shareable URLs.
- Search defaults to grid, supports list toggle and infinite scroll.
- Listing contact works without account and sends transactional emails.
- Seller wizard enforces 2-20 images and includes preview before publish.
- Listing lifecycle enforces moderation and 30-day expiry with renewal.
- Free window pricing rule is configurable and active in logic.
- Dealer posting is gated by active subscription status.
- Favourites and saved searches work for authenticated users.
- Admin can approve/takedown listings and process reports.
- Terms/privacy/cookies and buyer safety pages are live and linked.
- `robots` and sitemap are available.
- Seed can generate 100-300 realistic listings.
- Vitest and Playwright suites run locally with documented setup.
# Isle of Man Marketplace (itrader.im) — PRD + Implementation Plan

This document is the **source of truth PRD** and a **build-ready implementation plan** for an Isle of Man hyper-local marketplace MVP. It is written to be actionable by another engineer/model to implement directly.

---

## PRD Overview

### Vision
Build a trusted, hyper-local marketplace for the Isle of Man that starts with **vehicles** and can expand into high-value specialist categories (HiFi/Home AV, marine, musical instruments, photography gear, etc.) while keeping overhead and admin workload low.

### Goals
- **Monetize quickly**:
  - Private seller paid listing fee (e.g. **£4.99–£9.99** for **30 days**).
  - Dealer subscriptions (e.g. **£29.99–£49.99 / month**, unlimited listings).
  - Featured listing upgrade (e.g. **+£4.99**).
- **Buyer experience**: fast browse + search + filters tuned to local discovery.
- **Seller experience**: minimal steps to list + pay + go live after moderation.
- **Ops**: manual moderation is acceptable; provide simple admin tools.
- **Deployability**: run on **Vercel** (serverless), low maintenance.

### Non-goals (v1, to avoid scope creep)
- No native iOS/Android apps.
- No real-time chat/messaging system (use **contact form/email** only).
- No ML ranking, recommendations, or personalization.
- No shipping, escrow, in-app delivery, multi-currency/tax.
- No complex dispute automation (manual resolution only).

---

## Target Users

### Buyers
People in the Isle of Man looking for vehicles and other high-value items, with an expectation of credible listings and straightforward seller contact.

### Private sellers
Individuals selling one or a few items; want a simple listing flow and predictable pricing.

### Dealers
Businesses with inventory who want recurring billing, profile presence, and bulk listing management.

### Admin / Moderators
Side-hustle operators managing listings, reports, payments, categories, and users with minimal overhead.

---

## Success Metrics (Month 3 / 6 / 12)

### Month 3
- **150+ live listings**
- **20+ active dealers**
- **≥30%** of initiated listings convert to paid/published
- Median moderation time **< 48 hours**
- < 3% listings require refunds or disputes

### Month 6
- **500+ live listings**
- **50+ active dealers**
- **≥40%** paid conversion for listings
- 2–3 new categories launched beyond vehicles
- SEO: steady growth in impressions for category/region pages

### Month 12
- **1,500+ listings**
- **100+ dealers**
- 10+ categories, optional expansion to one additional island (Jersey/Guernsey)
- Repeat dealer retention > 70% at 3 months

---

## Assumptions + Risks

### Assumptions
- Users accept small listing fees for a higher-quality, moderated local platform.
- Dealers want an alternative to broad classifieds with local intent.
- Manual moderation is feasible at MVP scale.

### Risks (small island dynamics)
- **Reputation spillover**: disputes can become local social issues quickly.
- **Fraud/scams**: higher-value categories attract scams; support burden can spike.
- **Inventory scarcity**: low initial listings may slow SEO + buyer demand.
- **Pricing sensitivity**: listing fee too high can kill supply; too low reduces profitability.

Mitigations:
- Clear rules and moderation guidelines; visible “report listing” flow.
- Simple refund SOP and logging.
- Category-by-category rollout using feature flags.

---

## User Stories + Acceptance Criteria

### Buyer journeys

#### Browse listings by category + region
- **Story**: As a buyer, I can browse listings by category and region so I can find relevant items.
- **Acceptance**:
  - Category pages show listing grid with filters.
  - Region is visible on cards and detail pages.
  - Only LIVE listings are visible in public browse/search.

#### Search and filter
- **Story**: As a buyer, I can search by keywords and filter by price range and category.
- **Acceptance**:
  - Search query filters by title/description (MVP) and shows result counts.
  - Price range filtering works with pagination and stable URLs.
  - Filters are reflected in query params for shareable URLs.

#### Listing detail
- **Story**: As a buyer, I can view a listing with photos, specs, and contact options.
- **Acceptance**:
  - Gallery renders all images; fallback if none.
  - “Specifications” render category-specific attributes.
  - “Contact seller” form present (no in-app chat).

#### Edge cases
- EXPIRED listings: not returned in search/browse; direct URL shows “expired” state (or 404 if you prefer).
- TAKEN_DOWN listings: 404 for public; visible in admin.
- APPROVED but not LIVE: public behavior defined (recommended: treat as LIVE once approved; otherwise use LIVE state explicitly).

### Private seller journeys

#### Create listing
- **Story**: As a seller, I can create a draft listing with required details and photos.
- **Acceptance**:
  - Required fields validated client + server.
  - Upload limits enforced (file type, size).
  - Draft can be edited before paying.

#### Pay to publish
- **Story**: As a seller, I can pay and then my listing is submitted for moderation.
- **Acceptance**:
  - Listing does not become public until Stripe checkout is successful.
  - After payment, listing transitions to PENDING and appears in admin queue.

#### Edit / renew / expire
- **Story**: As a seller, I can edit my listing or renew it after it expires.
- **Acceptance**:
  - Editing resets to DRAFT/PENDING depending on policy (recommended: DRAFT then PENDING).
  - Renewal triggers a new paid period and updates `expiresAt`.

#### Edge cases (payments / ops)
- Payment succeeds but DB write fails: record webhook event + mark transaction “needs review”.
- Refund requested: admin can mark refunded and take listing down.
- Duplicate submissions: idempotency prevents double-charging and double state transitions.

### Dealer journeys

#### Subscribe and list inventory
- **Story**: As a dealer, I can subscribe monthly and publish unlimited listings.
- **Acceptance**:
  - Subscription status gates ability to publish.
  - Dealer profile page shows contact info + listings.

#### Manage listings
- **Story**: As a dealer, I can create/manage multiple listings.
- **Acceptance**:
  - Dealer dashboard lists their listings and statuses.
  - Bulk features not required v1 (add later).

### Admin / moderation journeys

#### Moderation queue
- **Story**: As admin, I can approve/reject listings quickly.
- **Acceptance**:
  - A queue shows PENDING listings sorted by age + flags.
  - Approve sets LIVE + expiresAt; reject sets TAKEN_DOWN (and stores admin note).

#### Category + attribute management
- **Story**: As admin, I can add categories and their attributes without code changes.
- **Acceptance**:
  - AttributeDefinition records drive listing forms (dynamic fields).

#### Reports & takedowns
- **Story**: As admin, I can review reports and take down listings.
- **Acceptance**:
  - Reports are stored with status and admin notes.
  - Takedown removes listing from public immediately.

---

## Information Architecture

### Site map (MVP)
- Home
- Categories
  - Category detail (`/categories/[slug]`)
- Search (`/search`)
- Listing detail (`/listings/[id]`)
- Dealer profile (`/dealers/[slug]`)
- Sell flow
  - Create listing (`/sell`)
  - Checkout success (`/sell/success`)
- Pricing (`/pricing`)
- Admin (protected)
  - Dashboard (`/admin`)
  - Listings moderation (`/admin/listings`)
  - Categories (`/admin/categories`)
  - Revenue (`/admin/revenue`)
- UI demo (internal reference): `/uidemo` (moved from `/styleguide`)

### Navigation model
- Top nav: Home, Categories, Sell, Pricing + Search input
- Footer: Terms, Privacy, Contact

### SEO approach
- Indexable category pages + future region pages.
- Listing pages include canonical URLs and structured data.
- Pagination uses canonical to page 1 (or `rel=prev/next` if you prefer).
- Future programmatic SEO:
  - region/category combos
  - make/model pages for vehicles
  - “dealer inventory” pages

---

## Data Model & Domain Design (Very Important)

### Category-specific attributes strategy

**Recommendation (MVP): EAV**
- Tables:
  - `AttributeDefinition` (per-category attribute schema)
  - `ListingAttributeValue` (per-listing attribute values)
- Pros: new categories and attributes without schema rewrites.
- Cons: more complex queries; may need careful indexing; limited type enforcement.

**Alternative (later): JSONB on Listing**
- Pros: simpler reads; fewer joins.
- Cons: harder validation; indexing complexity; migrations for shared attributes.

**Decision**: Use **EAV in MVP**. Revisit JSONB/dedicated columns once a category stabilizes and query patterns are known.

### Domain entities (minimum viable)
- User / DealerProfile
- Region (first-class, multi-island ready)
- Category (hierarchical)
- AttributeDefinition + ListingAttributeValue (EAV)
- Listing + ListingImage
- Payment + Subscription
- Report (trust & safety)

### Status model
\n- ListingStatus: DRAFT → PENDING → LIVE → EXPIRED → TAKEN_DOWN\n- PaymentStatus: PENDING → SUCCEEDED → FAILED → REFUNDED\n- ReportStatus: OPEN → REVIEWED → ACTIONED → DISMISSED\n- SubscriptionStatus: ACTIVE / PAST_DUE / CANCELLED / INCOMPLETE\n+
### Indexes (MVP)
- `Listing(categoryId, regionId, status)` for browse
- `Listing(price)` for filtering
- `Listing(createdAt)` for sorting “latest”
- `ListingAttributeValue(attributeDefinitionId, value)` for attribute filtering
- `Category(slug)` and `Region(slug)` for SEO routes

---

## Architecture (Vercel-ready)

### Recommended backend
**Postgres + Prisma** (hosted on **Supabase** or **Neon**)
- Works well with Vercel/serverless.
- Prisma migrations provide strong change tracking.

### Images / file storage
**Cloudinary**
- Easy transforms/CDN.
- Great for marketplace photos.
- Keep upload constraints to reduce moderation burden.

### Authentication
**Clerk**
- Fast setup and admin-friendly user management.
- SSR/App Router compatible.

Note: During local development without Clerk configured, the app should degrade gracefully (no auth gates, or a simple stub). For production, Clerk keys must be valid.

### Payments & subscriptions
**Stripe**
- One-off payments for listing fees and featured upgrades.
- Recurring subscription for dealers.
- Webhooks to confirm payment status; always treat webhooks as source of truth.

### Moderation pipeline
- Sellers create DRAFT → pay → PENDING
- Admin approves → LIVE and sets `expiresAt`
- Nightly job (cron) can expire listings, or compute expiry at query time (MVP acceptable).

### Search strategy
MVP: Postgres `contains` search + indexed filtering.
Future: pluggable search service interface (Meilisearch/Algolia/Typesense) without changing UI routes.

---

## API / Server Actions Design

### Major server actions
- `createListing(input)`
- `updateListing(input)`
- `saveListingImages(listingId, images[])`
- `payForListing(listingId)` → creates Stripe Checkout session
- `createDealerSubscription()`
- `submitListingForReview(listingId)`
- `renewListing(listingId)`
- `reportListing(input)`
- Admin:
  - `moderateListing({ listingId, action, adminNotes? })`
  - `createCategory(input)`
  - `createAttributeDefinition(input)`
  - `getAdminStats()`

### Validation
Use **zod** on every action input and route handler.

### Rate limiting / abuse prevention
- Throttle:
  - create listing
  - report listing
  - checkout creation
- Consider Upstash Ratelimit in production; for MVP, a simple limiter is acceptable but must be swapped later.

### Webhooks + idempotency
- Stripe events:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `charge.refunded`
- Idempotency:
  - Store idempotency keys and/or Stripe IDs in DB
  - Upsert subscriptions by Stripe subscription ID
  - Ensure payment creation is unique by payment intent ID

---

## UI System & Components (Use Existing Custom UI Library)

### Hard rule
Use the existing component library:
- UI primitives: `components/ui/*`
- Domain components: `components/marketplace/*`

Do **not** introduce a new UI system.

### Tokens + styling
- Design tokens source: `private/design-system.json`
- Generated CSS variables: `styles/tokens.css`
- Tailwind v4 theme usage: `app/globals.css` via `@theme inline`

### Component inventory (MVP screens)
- Marketplace:
  - `ListingCard`, `SearchBar`, `FilterPanel`
- UI primitives:
  - `Button`, `Input`, `Select`, `Checkbox`, `Slider`, `Badge`, `Card`, `Dialog`, `Table`, `Pagination`, `Alert`, `Toast`, `EmptyState`, `Skeleton`

### Responsive requirements
- Mobile-first:
  - Listing grid: auto-fill min width 280px
  - Filter panel collapses to drawer or top filters (Phase 2), or hidden behind button

### Accessibility notes
- Use `focus-visible` ring (`shadow-outline`) consistently
- Ensure all form inputs have labels / aria-describedby for errors
- Keyboard navigation parity for dropdowns/sliders/dialogs

---

## Implementation Plan (2–6 weeks, side-hustle optimized)

### Milestone 0 (Day 1 slice)
Goal: prove end-to-end value chain.
- Create listing DRAFT (title, description, price, category, region)
- Upload 1–3 photos (Cloudinary)
- Stripe checkout for listing fee
- After payment: listing becomes PENDING
- Admin approves → listing becomes LIVE
- Public can browse LIVE listings on Home + Category page

### Milestone 1 (Week 1–2): Core marketplace + payments
**Epics**
- Data model + migrations
- Listing CRUD + image upload
- Stripe checkout + webhook confirmation
- Browse/search/filter pages (MVP)
- Admin moderation queue (approve/reject/takedown)

**Deliverables**
- Public pages: home, categories, listing detail, search, pricing, sell
- Admin: dashboard + listings moderation
- Basic SEO metadata + JSON-LD on listing detail

### Milestone 2 (Week 3–4): Dealer subscriptions + category extensibility
**Epics**
- Dealer profile creation (admin-assisted initially)
- Subscription checkout + webhook sync
- Dealer listing management dashboard
- Category + attribute admin tooling improvements

### Milestone 3 (Week 5–6): Hardening + SEO + analytics
**Epics**
- Error handling, logs, monitoring
- Analytics integration (Plausible/PostHog)
- SEO landing pages (category/region scaffolding)
- Performance pass (image optimizations, caching strategy)
- E2E smoke tests (Playwright)

### Phase 2 improvements (explicitly not v1)
- Saved searches + email alerts
- Featured placement auction/ranking
- Messaging system
- Advanced fraud detection
- Search provider swap (Meilisearch/Algolia)

---

## Operational Plan

### Admin SOP (simple, repeatable)
Moderation checklist:
- Photos are real and relevant
- Price sanity check
- Contact info present (email/phone via seller/dealer)
- Obvious scam triggers (too cheap, stock images, off-island contact)

Response templates:
- Approve message
- Reject message (reason + refund policy)
- Takedown message (policy violation)

Refund/dispute handling:
- Refund on clear policy violation or accidental duplicate payment
- Log admin notes on Payment/Report records

### Backups, logging, monitoring
- DB backups daily (Supabase/Neon built-in)
- Sentry for exceptions
- Logtail (or Vercel logs + retention) for runtime logs

### Analytics
- Plausible (simple) or PostHog (deeper)
- Track:
  - listing create started → paid → approved → live
  - search → listing view → contact form submit
  - dealer subscribe funnel

### Cost estimates (monthly, MVP)
- Vercel: £0–£20
- DB: £0–£25
- Cloudinary: £0–£20
- Sentry/analytics: £0–£20
- Stripe: per transaction fees

---

## Quality & Testing

### Unit tests (high value)
- Validation schemas (zod)
- Price formatting / fee calculation
- Rate limit logic
- Listing status transitions (policy rules)

### E2E smoke tests (Playwright)
- Create listing → checkout (Stripe test) → success → admin approve → listing visible
- Search + filters + pagination
- Report listing flow

### Upload tests
- Enforce file type/size
- Ensure image count limits

### Stripe webhook tests
- Stripe CLI to replay events
- Verify idempotency and correct state transitions

### Security basics
- OWASP baseline
- Input validation everywhere
- Avoid exposing secrets in client
- Cloudinary upload preset restricted
- Consider malware scanning guidance (Phase 2)

---

## Deliverables

### Repo structure proposal (aligned to current repo)
- `app/(public)/*` public pages
- `app/(admin)/*` admin pages
- `app/api/webhooks/stripe/route.ts` webhook handler
- `actions/*` server actions
- `components/ui/*` primitives (existing)
- `components/marketplace/*` domain components (existing)
- `lib/*` db/auth/payments/validations
- `prisma/*` schema + migrations + seed
- `docs/prd.md` (this document)

### Environment variables (MVP)
- Database:
  - `DATABASE_URL`
- Clerk:
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  - `CLERK_SECRET_KEY`
- Stripe:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
  - `STRIPE_DEALER_PRICE_ID`
- Cloudinary:
  - `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`
  - `CLOUDINARY_API_KEY`
  - `CLOUDINARY_API_SECRET`
- App:
  - `NEXT_PUBLIC_APP_URL`

### README outline for future devs
- Quick start + env vars
- DB setup + migrations + seeding
- Stripe webhook setup (Stripe CLI)
- How to add categories/attributes
- Deployment steps (Vercel)

### Definition of Done (MVP)
- Paid listing flow works end-to-end with webhooks
- Admin moderation queue works
- Public browse/search works with filters + pagination
- Images upload reliably with constraints
- Basic SEO metadata + JSON-LD on listing pages
- Tests + build pass in CI

---

## Required Housekeeping: Move UI Demo to `/uidemo`

This is explicitly for reference and should not be the “site”.

### Tasks
- Move `app/styleguide/page.tsx` → `app/uidemo/page.tsx`
- Update [docs/ui.md](./ui.md) to point to `/uidemo` (instead of `/styleguide`)
- Ensure navigation does **not** surface `/uidemo` publicly (admin-only or hidden route)

