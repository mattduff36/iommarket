# Database Migrations How-To

This runbook explains how to run database migrations for this project safely and repeatably.

## 1) Prerequisites

- Ensure dependencies are installed: `npm install`
- Ensure `.env.local` exists at repo root.
- Required variables (names only):
  - `POSTGRES_URL_NON_POOLING` (preferred for migrations)
  - or `DATABASE_URL` (fallback)

The Prisma CLI in this repo loads `.env.local` via `prisma.config.ts`, so standard Prisma commands will target the configured database automatically.

## 2) Check migration status (always first)

Run:

```bash
npx prisma migrate status
```

Expected outcomes:
- **Up to date**: no pending migrations.
- **Pending migrations**: apply them with deploy (section 4).
- **Drift/error**: stop and investigate before applying anything.

## 3) Create a migration

### Schema change migration (preferred for model changes)

1. Update `prisma/schema.prisma`.
2. Generate migration:

```bash
npx prisma migrate dev --name <short_migration_name>
```

This creates a new folder in `prisma/migrations/<timestamp>_<name>/migration.sql`.

### Data-only migration (for content/backfill updates)

If schema is unchanged but data must be updated, create a migration folder manually and add SQL:

```text
prisma/migrations/<timestamp>_<name>/migration.sql
```

Use idempotent SQL when practical (`WHERE NOT EXISTS`, defensive updates, etc.).

## 4) Apply migrations to the configured database

Run:

```bash
npx prisma migrate deploy
```

This applies all pending migration folders in order and records them in `_prisma_migrations`.

## 5) Verify after apply

Recommended checks:
- Re-run:

```bash
npx prisma migrate status
```

- Run targeted data verification queries via app DB client or SQL.
- Smoke-test affected UI/API flows.

## 6) Supabase MCP workflow (optional/advanced)

Use this only after verifying the MCP server points at the same project/database as your local migration target.

### Step A: Verify MCP project identity

Call:
- `get_project_url`
- `list_migrations`

If the MCP project URL/project identity does not match the intended environment, **do not apply** migration SQL through MCP.

### Step B: Apply SQL via MCP (only when project matches)

Use `apply_migration`:
- `name`: snake_case migration name
- `query`: SQL to execute

Then verify with:
- `list_migrations`
- `list_tables` and/or `execute_sql` checks

## 7) Safety checklist

- Confirm you are targeting the correct environment before running any apply command.
- Prefer `migrate deploy` in shared/staging/prod-style environments.
- Keep migrations committed in git (`prisma/migrations/...`) so environments stay consistent.
- Never store credentials or secrets in migration files or docs.

## 8) Useful commands

```bash
# Check status
npx prisma migrate status

# Apply pending migrations
npx prisma migrate deploy

# Create new schema migration (dev)
npx prisma migrate dev --name <name>

# Open Prisma Studio for inspection
npx prisma studio
```

