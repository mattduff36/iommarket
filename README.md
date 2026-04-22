# itrader.im — Isle of Man Hyper-Local Marketplace

A trusted, hyper-local marketplace for the Isle of Man. Buy and sell vehicles, marine, hi-fi, instruments, photography gear, and more from trusted local sellers on the island.

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **UI**: React 19, Tailwind CSS v4, shadcn/ui + Radix UI
- **Database**: PostgreSQL + Prisma ORM
- **Auth**: Supabase Auth
- **Payments**: Ripple (Hosted Checkout + Webhooks)
- **Images**: Cloudinary
- **Deployment**: Vercel (serverless)
- **Testing**: Vitest (unit) + Playwright (E2E)

## Quick Start

### 1. Clone and install

```bash
git clone <repo-url>
cd iommarket
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (Supabase/Neon) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server only) |
| `RIPPLE_LISTING_PAYMENT_URL` | Ripple hosted payment URL for private listing checkout |
| `RIPPLE_LISTING_SUPPORT_URL` | Ripple hosted payment URL for optional support payments |
| `RIPPLE_FEATURED_PAYMENT_URL` | Ripple hosted payment URL for featured upgrades |
| `RIPPLE_DEALER_STARTER_URL` | Ripple hosted subscription URL for dealer starter |
| `RIPPLE_DEALER_PRO_URL` | Ripple hosted subscription URL for dealer pro |
| `RIPPLE_DEALER_STARTER_PLAN_ID` | Ripple plan ID used to map starter subscriptions from webhooks |
| `RIPPLE_DEALER_PRO_PLAN_ID` | Ripple plan ID used to map pro subscriptions from webhooks |
| `RIPPLE_WEBHOOK_SECRET` | Ripple webhook signing secret |
| `RIPPLE_DASHBOARD_URL` | Ripple portal URL for admin billing operations |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| `NEXT_PUBLIC_APP_URL` | App URL (e.g. `http://localhost:3000`) |

**Note:** Supabase credentials are required for authenticated journeys.
For local redirect smoke tests without onboarding credentials, the app falls back to public demo URLs from Ripple's `demo-gym` portal for hosted payment pages and the dashboard. A real `RIPPLE_WEBHOOK_SECRET` is still required to test webhook verification.

### 3. Database setup

```bash
# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate

# Seed with initial data (regions, categories, attributes)
npm run db:seed
```

### 4. Start development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Database

### Schema

The data model uses an **EAV (Entity-Attribute-Value)** pattern for category-specific attributes:

- **User** — synced from Supabase Auth
- **DealerProfile** — dealer business info
- **Region** — first-class geography (multi-island ready)
- **Category** — hierarchical categories
- **AttributeDefinition** — per-category attribute schema
- **ListingAttributeValue** — per-listing attribute values
- **Listing** — marketplace listings
- **ListingImage** — Cloudinary images
- **Payment** — provider-neutral payment records
- **Subscription** — provider-neutral dealer subscription records
- **Report** — trust & safety reports

### Status Models

```
Listing:      DRAFT → PENDING → LIVE → EXPIRED → TAKEN_DOWN
Payment:      PENDING → SUCCEEDED → FAILED → REFUNDED
Subscription: ACTIVE / PAST_DUE / CANCELLED / INCOMPLETE
Report:       OPEN → REVIEWED → ACTIONED → DISMISSED
```

### Migrations

```bash
npm run db:migrate     # Create/apply migrations
npm run db:push        # Push schema without migration
npm run db:studio      # Open Prisma Studio
npm run db:seed        # Seed data
```

## Adding Categories & Attributes

Categories and attributes can be managed via the admin UI at `/admin/categories`, or via the seed file.

To add a new category:

1. Go to `/admin/categories`
2. Fill in the name, slug, and optional parent
3. After creation, add attributes via the AttributeDefinition model

Attributes support data types: `text`, `number`, `select`, `boolean`.

## Ripple Setup

### Hosted Checkout + Webhooks

Set the Ripple portal webhook destination to:

```bash
http://localhost:3000/api/webhooks/payments
```

Use a tunnel or public preview URL when Ripple needs a publicly reachable endpoint.

See `docs/payments/ripple-migration.md` for the current provider assumptions, event mapping, and cutover checklist.

### Webhook Events Handled

| Event | Action |
|-------|--------|
| `payment.succeeded` | Record payment, set listing to PENDING when applicable |
| `payment.failed` | Mark payment FAILED when linked metadata is present |
| `payment.refunded` | Mark payment REFUNDED |
| `subscription.created` / `subscription.updated` | Sync dealer subscription status and tier |
| `subscription.cancelled` | Mark subscription CANCELLED |

### Featured Upgrade

Live listings can be upgraded to "Featured" status for +£5 via a separate Ripple hosted payment flow.

### Dealer Subscriptions

Create Ripple starter and pro plans in the portal and set their IDs as `RIPPLE_DEALER_STARTER_PLAN_ID` and `RIPPLE_DEALER_PRO_PLAN_ID`.

## Cloudinary Setup

1. Create a Cloudinary account
2. Create an **unsigned upload preset** named `iommarket_unsigned`
3. Set the upload folder to `iommarket/listings`
4. Configure allowed formats: `jpg`, `jpeg`, `png`, `webp`
5. Set max file size to 10MB

## Testing

### Unit Tests

```bash
npm test          # Watch mode
npm run test:run  # Single run
```

Tests cover:
- Validation schemas (zod)
- Fee calculations
- Listing status transitions
- Rate limiting

### E2E Tests (Playwright)

```bash
# Install browsers (first time)
npx playwright install

# Run tests
npm run test:e2e

# Interactive UI mode
npm run test:e2e:ui
```

## Deployment (Vercel)

1. Connect your Git repo to Vercel
2. Set all environment variables in Vercel Dashboard
3. Ensure `DATABASE_URL` points to a production PostgreSQL instance
4. Set `NEXT_PUBLIC_APP_URL` to your production URL
5. Configure Ripple webhook endpoint to `https://yourdomain.com/api/webhooks/payments`
6. Deploy

Build command: `prisma generate && next build` (configured in `package.json`)

## Project Structure

```
app/
├── (public)/            # Public pages (home, categories, search, listings, sell, pricing, dealers)
├── (admin)/             # Admin pages (dashboard, listings, categories, revenue)
├── api/webhooks/payments/ # Payment webhook handler
├── uidemo/              # UI component demo page
└── layout.tsx           # Root layout

actions/                 # Server actions (listings, payments, admin)
components/
├── ui/                  # UI primitives (Button, Input, Card, Badge, etc.)
├── marketplace/         # Domain components (ListingCard, SearchBar, FilterPanel, ImageUpload)
├── layout/              # Layout components (SiteHeader, SiteFooter)
└── providers/           # Context providers

lib/
├── auth/                # Authentication helpers
├── db/                  # Prisma client
├── payments/            # Payment provider helpers
├── upload/              # Cloudinary helpers
├── validations/         # Zod schemas
├── listing-status.ts    # Status transitions & fee calculations
├── rate-limit.ts        # In-memory rate limiter
└── cn.ts                # Tailwind class merge utility

prisma/
├── schema.prisma        # Database schema
└── seed.ts              # Seed data

e2e/                     # Playwright E2E tests
__tests__/               # Vitest unit tests
docs/                    # Documentation
```

## Admin

Access the admin area at `/admin`. Requires a user with the `ADMIN` role.

To make a user an admin, update their role in the database:

```sql
UPDATE "User" SET role = 'ADMIN' WHERE email = 'your@email.com';
```

Or via Prisma Studio: `npm run db:studio`

## Design System

Design tokens are sourced from `private/design-system.json` and compiled to CSS variables.

```bash
npm run tokens:generate  # Regenerate tokens from design-system.json
```

View the component library at `/uidemo`.

See [docs/ui.md](docs/ui.md) for full documentation.
