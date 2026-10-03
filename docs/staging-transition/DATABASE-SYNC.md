# Production-to-development database management

This design powers the staging-only `/admin/database` page. Code and local verification do not establish that a live sync has run: record the deployed commit, reviewed plan and successful application separately. Production remains a read-only source throughout.

## Access and configuration

Every page/action requires a development administrator and the server-verified staging environment. Mutations require the exact `https://staging.itrader.im` Origin. Explicitly configured local development may use its exact localhost origin; missing or foreign origins are rejected. The production deployment cannot expose or run these tools.

`DATABASE_SYNC_SOURCE_READONLY_URL` is configured only on staging and points to a dedicated `itrader_staging_reader` production role. The worker never derives it from the application's production connection. The destination is the existing verified development Supabase project. Both identities and source privileges are checked before preparing a snapshot.

The reader has SELECT on 15 named tables: the 12 sync tables below plus `DealerPreviewPack`, `Subscription` and `_prisma_migrations`. The latter tables support exclusion, public visibility and compatibility checks; they are not copied. The role has no write, ownership, elevated server-file, role-membership or administration privileges. Role-scoped SELECT policies support complete inspection under RLS. Source reads run in a read-only transaction with bounded timeouts. See `PRODUCTION-READER.sql` and the provisioning script for exact grants.

A staging-only `DATABASE_SYNC_ENCRYPTION_KEY` protects snapshots and recovery backups with AES-256-GCM. Records live in the private `staging_admin.database_sync_runs` store, outside public application data. Retain the encryption key securely: losing it prevents backup recovery. Never place connection strings, keys, row exports or customer data in logs, browser responses or version control.

## The three operations

| Operation | Behaviour |
|---|---|
| Replace development | Make the ordinary development marketplace reflect the approved production snapshot. Preserve administrators, checklist and dealer preview packs. Remove development-only rows where safe; archive listings and hide dealer profiles when history must remain. |
| Merge production into development | Add or update approved production records while retaining development-only records. Use explicit source IDs, natural-key checks and per-table rules. Conflicts block application rather than silently combining unrelated identities. |
| Reset development | Clear the ordinary development marketplace without copying production. Preserve administrators, checklist, preview packs and required history. Archive/hide referenced records instead of erasing their history. |

Reset is **not** backup restore. Recovery from a verified encrypted backup is a separate, reviewed manual procedure.

The owner approved archiving the existing 302 development listings and hiding the 13 development dealer profiles while retaining their payment and review history. These are the reviewed starting counts, not permanent constants. Each new plan computes fresh archive/hide counts and separately reports physical deletions. Do not equate hiding or archiving with deleting history.

## Copy, preserve and exclude policy

The explicit sync manifest covers `Region`, `Category`, `AttributeDefinition`, `VehicleMake`, `VehicleModel`, `VehicleModelAlias`, `User`, `DealerProfile`, `Listing`, `ListingImage`, `ListingAttributeValue` and `ContentPage`. The source extractor and sanitizer select only approved fields.

- Copied application users receive synthetic, non-login identities and sanitised personal details. Supabase Auth users, passwords, sessions and tokens are not copied. Existing development administrators keep their accounts.
- Live payment IDs, subscriptions, entitlements, jobs, consent events, audit history and private storage are not cloned. Existing development payment/review history remains attached to retained records.
- A separate staging visibility registry mirrors eligible public dealers for marketplace browsing. It grants no payment entitlement and does not turn a copied dealer into a paid account.
- The single development checklist and dealer preview packs are preserved, along with their required related records. Production is not given a second checklist table.
- Listing media is copied as read-only `EXTERNAL` references, with deterministic `database-sync/<hash>` IDs and no Cloudinary asset ownership or upload-intent references. Signed originals retain their actual dimensions. Cleanup refuses this namespace before any provider request.
- Public Supabase dealer logo URLs remain production read-only references; development deletion requires its own exact storage origin and ownership path. Verified Cloudinary logos carry a read-only URL fragment recognized by both account-cleanup paths, so staging cannot claim deletion ownership. Unsupported hosts or media accounts fail closed.

## Review and application

1. Inspect connection identity, source privileges, schema, migration compatibility and table counts.
2. Prepare Replace, Merge or Reset. Preparation creates a frozen plan and encrypted development recovery snapshot; it does not apply marketplace changes.
3. Review additions, updates, physical removals, preserved/skipped rows, archive/hide totals and blockers. The browser receives summaries only, never full rows, hashes or backup material.
4. Within 30 minutes, type the exact confirmation: `REPLACE DEVELOPMENT`, `MERGE INTO DEVELOPMENT` or `RESET DEVELOPMENT`.
5. Application rechecks the administrator, operation ownership, expiry, encryption integrity, destination identity, protected records and destination snapshot. A changed destination invalidates the plan. Prepare again; no silent merge with concurrent edits is allowed.
6. The destination transaction and advisory lock serialize changes. Foreign-key references are examined before deletion, and protected records are checked again after application. Verification failures roll back the transaction.
7. Review the applied entry, counts, protected administrator sign-in, checklist, preview packs, marketplace visibility and read-only images. Record actual results rather than treating a successful preparation as a completed sync.

Preparation is rate-limited, and snapshots have row/size limits. A blocked or oversized plan requires investigation or a separately reviewed maintenance procedure, not bypassing guards. Keep staging email, payment and advertising side effects disabled as configured; copying data must not activate real customers, live tracking or billing.

## Recovery and release

Keep the verified encrypted pre-change snapshot and its matching key. A recovery operator must verify the intended development project, decrypt and inspect the backup privately, account for intervening changes, and restore only the approved development scope. Never use Reset as recovery and never target production with a restore.

All changes go through `staging` first. Verify its deployment and user-facing behaviour, then obtain approval for a staging-to-main pull request. Do not push directly to `main`. Installing production reader permissions changes access configuration only; sync application writes are confined to development.
