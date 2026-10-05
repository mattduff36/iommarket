# Database sync exclusions - integrated for staging rollout

## CURRENT: owner preview passed — ready for a manual merge — 2026-10-05T02:25Z

The owner's manual scoped Merge preview passed and offered `MERGE INTO DEVELOPMENT`. No hosted Merge, Replace, Reset, or Restore has been applied.

Permanent exclusions remain: preview packs and linked preview accounts/listings, waitlist tables, monitoring tables, promotional campaigns and related onboarding records, dependent rows required for referential integrity, administrator accounts, and user IDs `cmusfwkh5000006pjpp1gnslj` and `cmus3bgau000004jjx43oid1l` regardless of role. Existing staging records stay. Full-database Replace, Reset, and Restore stay disabled. Encrypted backup retention is not automatic scoped restoration.

No migration changes required. Read-only checks on PostgreSQL 17.6 as `postgres`, `transaction_read_only=on`, direct hosts verified:

- Production `snlqivvogfqesxpbjiei`: all 51 local Prisma migrations have a finished record. `itrader_sync_export.auth_users` and `auth_identities` are present. `staging_admin` sync storage is absent. The private Auth export was not replayed.
- Development `syneonzucehwlghqmfbg`: all 51 local Prisma migrations have a finished record. `staging_admin` sync tables are present. `itrader_sync_export` is absent.
- Both databases also retain an older rolled-back row for `20260317153000_dealer_reviews` beside its finished row. That history was not rewritten.

`DATABASE_SYNC_AUTH_SOURCE_MODE=private-views` remains Preview on git branch `staging` only. Production does not have that variable. The reader URL and encryption key were not changed.

Live staging is preview deployment `dpl_GhLYxaK7swVVnFzJweQPePsthEaR`, commit `b2e22f6182aaca73a45b2887c7881a433591ec96`, READY at 2026-10-05T02:14:35.604Z, aliased to `itrader.dev`. No further deployment was created. Unrelated ImageKit and admin-profile work and all stashes were left uncommitted.

Unverified: the owner has not yet applied Merge on the shared development database.

## Current owner-approved scope

Exclude preview packs, linked preview accounts/listings and dependent rows, all Waitlist tables, Monitoring tables, DealerPromotionCampaign, DealerOnboardingInvite and related events. Exclude User IDs cmusfwkh5000006pjpp1gnslj and cmus3bgau000004jjx43oid1l regardless of role. Administrator accounts are excluded. Existing staging records and linked Auth sessions are preserved.

## Implementation

- The copy catalog omits the excluded table families.
- No campaign, waitlist, monitoring or pack identity conflict comparisons run.
- Source rows owned by excluded users/dealers or referencing excluded parents are omitted using the actual foreign-key graph.
- Excluded destination identities are protected even when production has different IDs.
- Auth users and identities attached to exclusions are not imported or overwritten.
- Included source rows alone enter snapshot storage and unique-key checks.
- Inspection counts and schema compatibility omit excluded tables and unused enum definitions. Raw destination fingerprint still guards changes between prepare and apply.
- The manifest carries marketplace-exclusions-v1. Older prepared plans are rejected without modification.
- At apply time the destination scope is reread before backup/data writes to reject newly excluded rows or references.
- Full-database Replace, Reset and Restore are disabled because they can modify excluded records. Encrypted included-data backups and transaction rollback remain. Automatic scoped restoration is NOT implemented.

## Boundaries and checks

The previously blocked code-only integration was executed following explicit owner approval. No database lookup or data mutation was run during this integration. No tests or blocker investigation were performed. TypeScript completed with exit 0. Normal Vercel build must succeed before the deployment is described as live.

The shared workspace stays on staging. Only the exclusion implementation and this document belong in this commit. Existing ImageKit/admin-profile edits and stashes are not part of this task. Production main and hosted environment settings remain unchanged.

## Next action

Deploy the scoped source changes to staging through the normal Git/Vercel workflow, then record the READY deployment and exact commit locally. The owner must refresh the staging database page and prepare a NEW Merge preview. No shared-development Merge, Replace, Reset or Restore has been applied. A READY deployment is not a proven hosted merge.
