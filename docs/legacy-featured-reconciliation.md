# Legacy Featured payment reconciliation

The listing and Featured migration adds `Payment.featuredAppliedAt` without guessing at legacy payment history. The approval-time Featured consumer must stay out of preview and production until this reconciliation has passed for the target environment.

## Why this gate exists

Some historic successful Featured payments were applied immediately and later cleared when a listing was taken down, rejected, expired, or returned to draft. Others may have been paid while the listing was not live and therefore never applied. A current `Listing.featured` value cannot distinguish those cases.

The reviewed audit found no qualifying production rows and 26 in preview: 24 synthetic seed payments, one Ripple payment, and one successful sample payment. The preview manifest is embedded in `scripts/reconcile-legacy-featured-entitlements.ts` and is checked by exact payment and listing IDs. Seed rows must still have `DEV` provider references under `seed:demo:`. The Ripple and sample rows must still be taken down, currently unfeatured, and have the ordering `APPROVE < successful payment event < TAKE_DOWN`.

## Required sequence

1. Apply the additive Prisma migration while the existing application version is running. The migration intentionally does not backfill historical payments.
2. Run the preflight in dry-run mode for the target environment:

   ```powershell
   npx tsx scripts/reconcile-legacy-featured-entitlements.ts --target preview
   npx tsx scripts/reconcile-legacy-featured-entitlements.ts --target production
   ```

   The command reads `.env.local` for preview or `.env.production` for production, verifies that the Supabase API and database URLs belong to the explicitly selected project, and prints only the target project reference and reconciliation counts. It does not print connection strings or payment references.
3. Review the dry-run output and confirm that the exact audited candidate set and provenance checks pass. Any extra, missing, refunded, changed, or ambiguous row stops the command. Update the reviewed manifest only after a new evidence review.
4. After explicit operational authorization, apply the metadata reconciliation for the reviewed target:

   ```powershell
   npx tsx scripts/reconcile-legacy-featured-entitlements.ts --target preview --apply
   npx tsx scripts/reconcile-legacy-featured-entitlements.ts --target production --apply
   ```

   The production set is expected to be empty. The preview apply marks the 24 synthetic seed rows as consumed so they cannot create future entitlements, and marks the two verified applied-then-cleared payments as consumed. It changes only `featuredAppliedAt`; it never changes listing status or `featured`.
5. Require `pending=0` and the expected update count before deploying the application version that consumes Featured entitlements on approval. If the candidate set or proof checks fail, do not deploy that consumer until the affected rows are reconciled and reviewed.

The command is dry-run by default. It uses a serializable transaction, an advisory lock, row locks, and exact-set checks before any update. There is no automatic rollback because clearing `featuredAppliedAt` can re-grant a benefit on a later approval; any correction needs a fresh evidence review.
