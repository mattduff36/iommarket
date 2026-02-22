# Services and Environment Decisions

## Database

- **Service**: PostgreSQL (Supabase Postgres recommended).
- **Why**: already aligned with Prisma + current repo architecture.
- **Env vars**:
  - `DATABASE_URL`
  - optional compatibility URLs (`POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`)
- **Local**: local Postgres container or Supabase dev project.
- **Staging/Prod**: managed Postgres with backups and migration pipeline.
- **Row Level Security (RLS)**: Enabled on all public tables (migration `20260222120000_enable_rls_public`). With no permissive policies for `anon`/`authenticated`, PostgREST access is denied. The app uses Prisma with the DB connection role (BYPASSRLS), so server-side access is unchanged.

## Authentication

- **Service**: Supabase Auth.
- **Why**: already implemented server-side with App Router and middleware.
- **Env vars**:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (server-only tasks/scripts)
- **Local**: Supabase hosted project acceptable for MVP local dev.
- **Staging/Prod**: separate Supabase projects per environment.

## Image Hosting and Processing

- **Service**: Cloudinary.
- **Why**: upload widget and helpers already integrated.
- **Approach**:
  - client upload via upload preset
  - persist `url` + `publicId` on `ListingImage`
  - use Cloudinary transformations for optimized rendering
  - delete Cloudinary assets when listing/images are removed
- **Env vars**:
  - `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`
  - `CLOUDINARY_API_KEY`
  - `CLOUDINARY_API_SECRET`
  - `CLOUDINARY_UPLOAD_PRESET`
- **Local**: same Cloudinary account with dev folder prefix.
- **Staging/Prod**: separate preset/folder naming for isolation.

## Payments

- **Service**: Stripe.
- **Why**: checkout + subscriptions + webhook model already in place.
- **Scope**:
  - one-time private listing payment (post-free-window)
  - dealer subscription billing
  - featured upsell one-time checkout
  - webhook-driven status sync + idempotency
- **Env vars**:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
  - `STRIPE_DEALER_PRICE_ID`
  - `STRIPE_FEATURED_PRICE_ID` (or amount config if using dynamic price_data)
  - `LISTING_FEE_PENCE`
- **Local**: Stripe test mode + stripe CLI forwarding webhooks.
- **Staging**: dedicated test keys/prices/webhook endpoint.
- **Production**: live keys, monitored webhook retries.

## Email

- **Service**: Resend.
- **Why**: selected decision, simple transactional integration.
- **Scope**:
  - contact seller delivery
  - report submission confirmation/notification
- **Env vars**:
  - `RESEND_API_KEY`
  - `RESEND_FROM_EMAIL`
  - optional `RESEND_REPLY_TO_EMAIL`
- **Local**: Resend test/dev domain and non-production sender.
- **Staging/Prod**: verified domain and monitored bounce/reject logs.

## Analytics

- **Service**: Vercel Analytics.
- **Why**: already installed and lightweight for MVP.
- **Events (MVP minimum)**:
  - listing viewed
  - search performed
  - contact seller submitted
  - listing created/submitted
- **Env vars**: none required beyond deployment defaults.
- **Local**: optional/no-op acceptable.
- **Staging/Prod**: enabled in deployment project.

## Error Monitoring (Recommended)

- **Service**: Sentry (minimal setup).
- **Why**: production-ready error visibility for server actions/routes.
- **Env vars**:
  - `SENTRY_DSN`
  - optional `SENTRY_AUTH_TOKEN` (build sourcemaps)
  - optional `SENTRY_ENVIRONMENT`
- **Local**: optional disabled.
- **Staging/Prod**: enabled with environment tags.

## Moderation Tooling

- **Service**: In-app admin dashboard (existing routes extended).
- **Why**: questionnaire requires basic moderation for MVP.
- **Scope**:
  - listing queue approve/takedown
  - report workflow and admin notes
  - dealer verification visibility
- **Env vars**: none service-specific.

## Cross-Environment Config

- **App config vars**:
  - `NEXT_PUBLIC_APP_URL`
  - `LAUNCH_FREE_UNTIL`
  - `FREE_LISTING_WINDOW_DAYS` (fallback strategy)
  - `DEV_PASS` (development-only gate)
- **Notes**:
  - staging should mirror production behavior as closely as possible.
  - all secrets must remain server-side and not leak to client bundles.
