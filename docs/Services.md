# Services and Environment Decisions

## Database

- **Service**: PostgreSQL (Supabase Postgres recommended).
- **Why**: already aligned with Prisma + current repo architecture.
- **Env vars**:
  - `DATABASE_URL` (direct non-pooled, used for migrations/seeds)
  - `POSTGRES_URL` (pooled, used at runtime by Prisma)
  - `POSTGRES_URL_NON_POOLING` (non-pooled runtime fallback)
  - `POSTGRES_PRISMA_URL` (pgBouncer-mode pooled URL)
  - `POSTGRES_DATABASE`, `POSTGRES_HOST`, `POSTGRES_PASSWORD`, `POSTGRES_USER` (Vercel Postgres integration)
- **Local**: Supabase hosted project or local Postgres container.
- **Staging/Prod**: managed Postgres with backups and migration pipeline.
- **Row Level Security (RLS)**: Enabled on all public tables (migration `20260222120000_enable_rls_public`). With no permissive policies for `anon`/`authenticated`, PostgREST access is denied. The app uses Prisma with the DB connection role (BYPASSRLS), so server-side access is unchanged.

## Authentication

- **Service**: Supabase Auth.
- **Why**: already implemented server-side with App Router and middleware.
- **Env vars**:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `SUPABASE_URL` (server-side alias)
  - `SUPABASE_SECRET_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (server-only tasks/scripts)
  - `SUPABASE_JWT_SECRET` (webhook verification)
  - `SUPABASE_AUTH_HOOK_SECRET` (Supabase Auth → Hooks → Send Email)
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

- **Service**: Ripple.
- **Why**: hosted checkout plus signed webhooks align with the current marketplace flow while keeping card collection off-site.
- **Scope**:
  - one-time private listing payment (post-free-window)
  - dealer subscription billing
  - featured upsell one-time checkout
  - webhook-driven status sync + idempotency
- **Env vars**:
  - `RIPPLE_LISTING_PAYMENT_URL`
  - `RIPPLE_LISTING_SUPPORT_URL`
  - `RIPPLE_FEATURED_PAYMENT_URL`
  - `RIPPLE_DEALER_STARTER_URL`
  - `RIPPLE_DEALER_PRO_URL`
  - `RIPPLE_DEALER_STARTER_PLAN_ID`
  - `RIPPLE_DEALER_PRO_PLAN_ID`
  - `RIPPLE_WEBHOOK_SECRET`
  - `RIPPLE_DASHBOARD_URL`
  - `LISTING_FEE_PENCE` (pence; default 499)
  - `LAUNCH_FREE_UNTIL` (ISO timestamp for time-based free window)
  - `FREE_LISTING_WINDOW_DAYS` (default 30)
- **Local**: use Ripple demo/hosted links and a publicly reachable webhook URL.
- **Staging**: dedicated Ripple hosted links and webhook endpoint.
- **Production**: live Ripple portal configuration plus monitored webhook retries.

## Email

- **Service**: Resend.
- **Why**: selected decision, simple transactional integration.
- **Scope**:
  - contact seller delivery
  - report submission confirmation/notification
  - waitlist confirmation + admin signup notifications
- **Env vars**:
  - `RESEND_API_KEY`
  - `RESEND_FROM_EMAIL`
  - `RESEND_REPLY_TO_EMAIL`
  - `RESEND_REPORTS_TO_EMAIL` (moderation/report notifications)
  - `RESEND_WAITLIST_TO_EMAIL` (comma-separated; falls back to `RESEND_REPORTS_TO_EMAIL`)
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

---

## Secrets Rotation Procedure

If any credential is suspected to be exposed (e.g. accidentally committed, visible in logs, or leaked via a third-party breach), follow these steps immediately:

### 1. Supabase
- **Anon key / JWT secret**: Supabase Dashboard → Settings → API → Reset keys.
- **Service role key**: Same page — rotate separately.
- **Auth hook secret**: Supabase Dashboard → Auth → Hooks → regenerate the signing secret; update `SUPABASE_AUTH_HOOK_SECRET` everywhere.
- **Database password**: Supabase Dashboard → Settings → Database → Reset password; update all `POSTGRES_*` and `DATABASE_URL` vars.

### 2. Ripple
- **Webhook secret**: rotate it from the Ripple portal/onboarding contact and update `RIPPLE_WEBHOOK_SECRET` in Vercel and local env files.
- **Hosted payment URLs / plan IDs**: update `RIPPLE_*` URLs and plan IDs whenever Ripple regenerates or replaces them.

### 3. Cloudinary
- **API secret**: Cloudinary Console → Settings → Access Keys → Generate new key pair. Update `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`.

### 4. Resend
- **API key**: Resend Dashboard → API Keys → Delete old key, create new. Update `RESEND_API_KEY`.

### 5. After rotation
1. Update Vercel env vars: `npx vercel env add <VAR> production --force` (repeat for preview / development).
2. Redeploy: `npx vercel --prod` or push to `main` to trigger CI.
3. Verify the env-check e2e suite passes: `npm run test:e2e -- --grep "\[AuthHook\]|\[Cloudinary\]|\[Resend\]|\[Payment"`.
4. Confirm no secrets remain in git history: `git log --all --full-history -- .env.production` should return nothing.

### Git safeguards in place
- `.gitignore` covers all `.env.*` files (broad glob + explicit entries for `.env.production`, `.env.staging`, `.env.development`).
- `.git/hooks/pre-commit` blocks any staged `.env.*` file from being committed.
- All production secrets are stored exclusively in Vercel (encrypted at rest).
