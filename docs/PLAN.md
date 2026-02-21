# Implementation Plan

## Phase 1: MVP Foundations

### Tasks

- Standardize environment contract and document all required variables.
- Extend Prisma schema with favourites, saved searches, and view tracking.
- Add migrations and upgrade seed data to 100-300 listings.
- Tighten write endpoint validation and anti-spam/rate limiting.
- Create delivery docs (`PRD`, services, plan) and align code with them.

### Files/Routes Affected

- `prisma/schema.prisma`
- `prisma/migrations/*`
- `prisma/seed.ts`
- `.env.example`
- `lib/rate-limit.ts`
- `lib/validations/*`
- `docs/PRD.md`
- `docs/Services.md`
- `docs/PLAN.md`

### Dependencies

- Existing Postgres connection and Prisma generation.

### Risks

- Migration drift across local/staging environments.
- Seed runtime and data realism for large sample size.

### Definition of Done

- Fresh migrate + seed works.
- Env template complete and consistent.
- Core write paths validated and rate-limited.

## Phase 2: Marketplace Core

### Tasks

- Homepage updates for trust stats + dealer spotlight + SEO block.
- Search page: sticky filters, infinite scroll, grid/list toggle, promoted styling.
- Canonical and crawlable filter URL strategy.
- Listing detail enhancements: gallery behavior, sticky contact area, similar listings, share actions.
- Seller wizard refactor: multi-step, photo limits (2-20), preview before submit.
- Implement favourites and saved searches for authenticated users.
- Implement contact seller flow (no-account) with Resend.

### Files/Routes Affected

- `app/(public)/page.tsx`
- `app/(public)/search/page.tsx`
- `components/marketplace/search/*`
- `app/(public)/listings/[id]/page.tsx`
- `app/(public)/listings/[id]/contact-form.tsx`
- `app/(public)/sell/*`
- `actions/listings.ts`
- new account routes/components for favourites and saved searches

### Dependencies

- Phase 1 schema and env updates complete.

### Risks

- Infinite scroll + SEO crawlability balancing.
- Complex form UX regression risk in sell wizard refactor.

### Definition of Done

- Search/listing/sell/contact journeys complete and testable end-to-end.

## Phase 3: Monetisation

### Tasks

- Implement free launch window logic and config.
- Enforce private listing payment after free period.
- Enforce dealer subscription active state for posting.
- Complete featured upsell reliability and idempotency paths.
- Harden webhook event handling and reconciliation behavior.

### Files/Routes Affected

- `actions/payments.ts`
- `lib/payments/stripe.ts`
- `app/api/webhooks/stripe/route.ts`
- listing submit/renew actions and related UI messaging

### Dependencies

- Stripe products/prices configured in test mode and staging.

### Risks

- Webhook retries and partial state sync edge cases.

### Definition of Done

- Monetisation rules are deterministic and covered by tests.

## Phase 4: Admin, Legal, Trust

### Tasks

- Expand moderation dashboard/report workflow.
- Add dealer verification badge visibility.
- Add legal pages (`/terms`, `/privacy`, `/cookies`) and buyer safety page/section.
- Add cookie consent UI and persist consent state.

### Files/Routes Affected

- `app/(admin)/admin/*`
- `actions/admin.ts`
- `components/layout/site-footer.tsx`
- new routes:
  - `app/(public)/terms/page.tsx`
  - `app/(public)/privacy/page.tsx`
  - `app/(public)/cookies/page.tsx`

### Dependencies

- Base moderation/report model fields available.

### Risks

- Legal copy quality (needs external legal review before launch).

### Definition of Done

- Admin moderation and trust/legal surfaces are complete for MVP.

## Phase 5: QA and Polish Readiness

### Tasks

- Add Vitest coverage for URL parsing, validation, pricing rules, publish flow.
- Add Playwright user journey tests:
  - homepage → search → listing
  - sell wizard happy path
  - moderation smoke
- Integrate Vercel Analytics event hooks.
- Optional minimal Sentry setup.
- Run lint/type/test pass and fix regressions.

### Files/Routes Affected

- `__tests__/*`
- `e2e/*`
- `app/layout.tsx`
- supporting instrumentation/helpers

### Dependencies

- Stable staging env vars and seeded data.

### Risks

- E2E flakiness in payment-related routes without controlled test mode.

### Definition of Done

- Local automated tests run successfully.
- Staging smoke verification checklist completed.

## Day-1 Staging Checklist

- Configure and verify all env vars from `.env.example`.
- Run Prisma migration and seed target volume (100-300).
- Verify Supabase auth callbacks and role seeding.
- Verify Cloudinary upload preset and image delete API behavior.
- Verify Stripe checkout + webhook endpoint in staging.
- Verify Resend domain sender and transactional delivery.
- Verify robots and sitemap endpoints.
- Run smoke E2E on staging URL.
