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

