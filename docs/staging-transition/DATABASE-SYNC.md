# Production-to-development database sync

The staging admin page at `/admin/database` is currently an inspection tool. It does not copy, reset, merge, migrate, or alter either database. The page is available only when the server identifies this deployment as staging and the signed-in user is an admin. It reports a selected set of table counts, public table structure, Prisma migration agreement, and blockers. Counts are a momentary observation, not a backup or an approval to sync.

## Connections and permissions

Set `DATABASE_SYNC_SOURCE_READONLY_URL` **only on the staging deployment** after creating a dedicated production PostgreSQL role with SELECT on the required production tables. This key is never inferred from `.env.production`, a normal application connection, or production service-role credentials. The destination is the staging application's existing preview-project database connection. The preflight checks the known Supabase project identities and refuses a writable, owner, superuser, bypass-RLS, role-creation, database-creation, replication, or elevated server-file source role. It also runs all SQL inside `BEGIN READ ONLY` with a statement timeout.

Grant creation, credential installation, and any remote database access require separate review. Grant only the SELECT and catalog visibility needed for inspection; future Auth and Storage reads require a separate design. Do not place database URLs, passwords, exports, personal data, or provider credentials in tickets, logs, the browser response, or version control.

## Replace development

Replace means a verified production snapshot becomes the development marketplace state. Development-only rows disappear unless explicitly preserved and restored. A production snapshot can include real customer accounts, payments, subscriptions, consent records, and contact information; staging must suppress all external side effects before such records become visible to application workers. A complete workflow needs:

1. A table-by-table manifest of data to copy, exclude, transform, and preserve, checked against the live schema and foreign keys.
2. A consistent read-only production snapshot, plus independently verified destination backup and rollback instructions.
3. Paused staging writers, background jobs, webhooks, notifications, payment capture, and monitoring alerts while the restore runs.
4. A destination-only restore that verifies project identities again immediately before writing. Production credentials must not be usable for writes by this worker.
5. Explicit Supabase Auth identity/session treatment and Storage object copy or URL rewrite. The application `User.authUserId` values must match destination Auth users. Copying only public tables breaks sign-in; copying live sessions or refresh tokens is unacceptable.
6. Post-copy migration, integrity, row-count, Auth, image, login, listing and payment-simulator checks before staging traffic resumes.
7. Reinstatement of development-only checklist and preview packs from separately verified staging backups, if those are to survive Replace.

## Merge into development

Merge retains development-only records and adds or updates approved production records. It is a separate operation from Replace. It needs stable natural or source IDs, per-table conflict rules, foreign-key mapping, deletion policy, privacy review, and a dry-run diff that names exactly which rows would be inserted, updated, preserved, or rejected. It must never silently reconcile money, identity, legal-retention, or pending work records by generic `upsert`. A skipped conflict remains visible in the report.

## Initial data policy to refine before enabling either mode

| Data | Initial policy |
| --- | --- |
| Vehicle catalogue, categories, regions, published content | Candidate for copy or merge after schema and reference checks. |
| Listings, listing images, dealer profiles | Copy only with owner identity and image objects/URLs resolved. Preserve genuine live stock; never hide all rows linked to a preview pack as a shortcut. |
| `DealerPreviewPack`, admin preview dealers, sample listings/checkouts | Staging-only. Preserve from staging backup on Replace; exclude from production import unless a named pack is deliberately mapped and reviewed. |
| `SiteSetting(admin_checklist)` | Staging is the only checklist writer. Preserve its one staging row on Replace; never import a production checklist row. Production UI and actions stay closed. |
| Other `SiteSetting` rows | Review keys individually. Pricing, sample visibility, launch controls, alert recipients/webhooks, and cost settings can change behavior or send external messages. |
| Supabase Auth, `User`, policy acceptance, favourites, saved searches, waitlist | Treat as linked identity and personal data. Define consent, retention, role mapping, test-account and sign-in behavior before any copy. |
| Payments, subscriptions, charges, webhook inboxes | Never activate cloned provider IDs, pending retries, or real entitlements in staging. Define a verified inert snapshot policy and simulator separation. |
| Email, cost, onboarding and deletion outboxes/jobs | Exclude or neutralize pending side effects; decide whether historical records are useful before import. |
| Monitoring issues/events/alert deliveries/pipeline health | Keep production and staging separate. A staging dashboard may show a source-labelled read-only production summary without merging records or replaying alerts. |
| Audit logs, retention holds/runs, account deletion jobs | Preserve provenance and legal constraints. Do not reattribute historical actors or release holds during a sync. |

The preflight page intentionally has no Replace or Merge button. Add those only after the worker, backup, Auth/Storage plan, audited per-table policy, conflict report, and rollback have been reviewed and tested against disposable data. A successful inspection alone does not authorize database mutation.
