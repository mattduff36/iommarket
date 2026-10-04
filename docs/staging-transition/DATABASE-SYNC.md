# Production-to-development database clone

This design powers the staging-only `/admin/database` page. Production stays read-only. The application does not apply `PRODUCTION-READER.sql` or `DEVELOPMENT-SYNC-STORE.sql`; install both manually and fail closed until the reader grants and store version are both current.

## Access

Every page and action requires an active development administrator and the server-verified staging environment. Mutations require the exact `https://itrader.dev` Origin. Prepare, apply and restore use a preview session connection. An explicit `DATABASE_SYNC_SESSION_URL` takes priority; otherwise the application prefers an existing preview session-pooler URL, derives the shared Supabase session endpoint on port 5432 from a verified port-6543 transaction-pooler URL, and uses a direct preview URL only as a final fallback. Inspection uses this same endpoint so it cannot report readiness through a connection that plans cannot use.

`DATABASE_SYNC_SOURCE_READONLY_URL` is staging-only and must be the `itrader_staging_reader` role on the production project. The reader needs SELECT, and an unconditional reader RLS policy, on every public table except `spatial_ref_sys`, plus `auth.users` and `auth.identities`. Its statement timeout is 240 seconds. It has no write, ownership, or elevated privileges.

## What is copied

Replace and Merge copy every current public Prisma table and physical column, including `Listing.featured`, users, payments, subscriptions, audit rows and the cost ledger. Values are preserved. Auth copies `auth.users` and `auth.identities` with stable IDs, rewrites `instance_id` to the preview project, sets `banned_until` to infinity, clears passwords and confirmation, recovery, email-change, phone-change and reauthentication tokens, and removes identity token material.

These Auth tables are not copied: sessions, refresh tokens, flow state, one-time tokens, MFA factors, challenges, AMR claims, `schema_migrations` and `instances`. After a clone, sessions and refresh tokens for imported users are deleted when those tables exist. Staging administrator sign-in is kept only when the public id, normalised email and auth user id are identical; any partial overlap blocks the plan.

Reset deletes development marketplace rows and clears clone provenance. It does not read production. It keeps the current staging administrators.

## Side effects

Each applied clone records immutable provenance for imported rows. On staging, email, payment checkout, webhooks, media deletion, monitoring alerts and account deletion fail closed for those rows. Outside staging the guard does nothing. If the provenance tables are missing, staging still allows effects because no clone has been installed. If a generation is active and the lookup fails, the effect stops. Cloned cost-ledger rows stay in the database for diagnosis. Canonical cost routing continues to use the live ledger, not the clone. No Supabase Storage or other chargeable Supabase service is used.

## Backups and restore

Apply and restore run in one preview transaction. They take one advisory lock and `SHARE ROW EXCLUSIVE` locks on every cloned public table plus `auth.users` and `auth.identities` before backup, drift checks or writes. The acting administrator is checked again after those locks. The local statement timeout is 240 seconds, inside the 300 second page limit.

Backup and source payloads are gzip-compressed AES-256-GCM chunks in `staging_admin`. The chunk key is `DATABASE_SYNC_ENCRYPTION_KEY` (64 hex characters). Losing the key makes backups unreadable. Chunks are not returned to the browser.

The newest backup does not expire. When a newer backup commits, the displaced backup's 30-day clock starts. Up to four older backups keep their existing expiry. A fifth older backup, or ciphertext over 500 MB, is pruned in the same transaction. The newest backup is never deleted, and a new backup larger than 500 MB aborts with no change. Expired and abandoned prepares drop payload chunks and keep safe metadata. Prepared plans are not restorable.

Any current staging administrator may restore an applied backup after typing `RESTORE DEVELOPMENT`. Restore is refused when the backup is missing, expired, pruned, tampered, for a different schema, or would remove that administrator. Restore first saves a new backup, so a restore can itself be restored.

## Rollout

1. Review and apply `PRODUCTION-READER.sql` on production. It grants read access only.
2. Review and apply `DEVELOPMENT-SYNC-STORE.sql` on the preview project.
3. Confirm the store version is 2 and the encryption key is set only on staging.
4. Open `/admin/database`, preview a plan, and apply it only after the blockers are clear.
