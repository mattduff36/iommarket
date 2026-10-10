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

Each applied clone records immutable provenance for imported rows. The clone copies media references only; it does not copy physical ImageKit or Cloudinary files.

Verified staging captures emails, monitoring alerts and outbound webhooks as redacted `AdminAuditLog` records with entity type `StagingTestEffect`. These flows complete without contacting recipients or requiring live provider configuration. Invalid staging or preview identity blocks delivery. Production retains its existing provider flow and safeguards.

Cloned users can upload new images into the managed staging namespace. User ownership, immutable paths and exact provider file identities remain required. Removing a copied production image changes staging records only: cleanup completes with `preserved-original` and does not fetch, delete or purge the original file. All legacy Cloudinary storage remains read-only on staging because its historical paths do not reliably prove environment ownership. New staging ImageKit files can be physically deleted; the storage boundary checks observed metadata and refuses production, migration and unknown paths even without clone provenance. Failed provenance lookups stop provider operations.

Cloned account deletion can complete local anonymisation while preserving lease fencing and legal holds. Auth admin operations validate staging identity before returning any cached client and target only the preview Supabase project.

Sample subscription checkout ignores only Subscription rows proven copied from production in the same transaction. It creates a separate DEV simulation subscription through the existing fulfillment path. Genuine preview subscriptions still block simulation; copied and genuine provider billing rows are preserved. Production payment simulation remains disabled.

Cloned cost-ledger rows remain available for diagnosis. Hosted staging uses the separate Accounts preview configuration. Read-only external reference lookups retain their existing behaviour. The next database refresh replaces staging test records and captures; it does not itself clean orphaned staging files from external storage. No Supabase Storage or other chargeable Supabase service is used.

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
