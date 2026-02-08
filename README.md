# IOM Market

A hyper-local marketplace for the Isle of Man. Buy and sell vehicles, marine, hi-fi, instruments, photography, and more from trusted local sellers.

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript (strict)
- **Styling**: Tailwind CSS v4 + custom design tokens
- **UI**: Local component library (shadcn/ui conventions, Radix UI primitives, CVA variants)
- **Database**: PostgreSQL + Prisma ORM
- **Auth**: Clerk
- **Payments**: Stripe (one-off listings + dealer subscriptions)
- **Images**: Cloudinary (via next-cloudinary)
- **Hosting**: Vercel

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL database (Supabase, Neon, or local)
- Stripe account (test mode)
- Clerk account
- Cloudinary account

### Setup

```bash
# Install dependencies
npm install

# Copy env vars
cp .env.example .env
# Fill in your values in .env

# Generate Prisma client
npm run db:generate

# Push schema to database
npm run db:push

# Seed categories and regions
npm run db:seed

# Start dev server
npm run dev
```

### Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |

### Stripe Webhook Setup

```bash
# Install Stripe CLI
# Then forward webhooks to local server:
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Events handled: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`.

## Project Structure

```
app/
  (public)/          # Public-facing pages (home, categories, listings, sell, pricing)
  (admin)/           # Admin dashboard (protected, requires ADMIN role)
  api/webhooks/      # Stripe webhook handler
actions/             # Server actions (listings, payments, admin)
components/
  ui/                # UI primitives (Button, Input, Card, etc.)
  marketplace/       # Domain components (ListingCard, SearchBar, FilterPanel)
  layout/            # Layout components (SiteHeader, SiteFooter)
lib/
  db/                # Prisma client singleton
  auth/              # Clerk auth helpers
  payments/          # Stripe client + helpers
  upload/            # Cloudinary upload helpers
  validations/       # Zod schemas
  rate-limit.ts      # In-memory rate limiter
prisma/
  schema.prisma      # Database schema
  seed.ts            # Seed data
styles/
  tokens.css         # Generated CSS custom properties
private/
  design-system.json # Design token source of truth
```

## UI Library

See [docs/ui.md](docs/ui.md) for full documentation on the component library, design tokens, and usage patterns.

- Tokens are generated from `private/design-system.json`
- Run `npm run tokens:generate` to regenerate CSS variables
- View all components at `/styleguide`

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:push` | Push schema to database |
| `npm run db:migrate` | Run database migrations |
| `npm run db:seed` | Seed categories and regions |
| `npm run db:studio` | Open Prisma Studio |
| `npm run tokens:generate` | Regenerate CSS tokens from design system |
| `npm test` | Run tests (watch mode) |
| `npm run test:run` | Run tests once |

## Testing

```bash
npm test
```

Tests cover validation schemas, rate limiting, and core business logic. Located in `__tests__/`.

## Deployment

Deploy to Vercel. The build command runs `prisma generate` automatically before `next build`.

Set all environment variables in Vercel project settings. Configure the Stripe webhook endpoint to point to `https://your-domain.com/api/webhooks/stripe`.
