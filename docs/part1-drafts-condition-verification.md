# Part 1: draft deletion and vehicle condition verification

Local implementation checkpoint, 22 November 2026. Staging execution and release verification are owned by the release coordinator. This is not a production approval.

## Changed-file audit

| Files | Change and review |
| --- | --- |
| `prisma/schema.prisma`; `prisma/migrations/20261122180000_draft_deletion/migration.sql`; `prisma/migrations/20261122181000_vehicle_condition/migration.sql` | Owner archive timestamp; NEW/USED enum on listing and revision; condition/status index; conservative dealer evidence-review flag. Migrations applied to staging by coordinator; files frozen. |
| `lib/listings/delete-draft.ts`; `actions/delete-draft.ts` | Authenticated and validated owner deletion. Serializable transaction and row lock enforce owner/status/revision; stock handoffs remain on dedicated discard workflow. Payment, checkout, quota-claim and live history retain archived rows. Image cleanup checks references. |
| `components/account/account-listing-actions.tsx`; `app/(public)/account/listings/page.tsx`; `components/account/dealer-account-page.tsx` | Confirmation and pending states; owner-archived drafts hidden from private/dealer dashboards. |
| `actions/listings.ts`; `lib/listings/status-events.ts`; `lib/listings/editable-draft.ts`; `lib/listings/photo-mutation.ts` | Deleted drafts cannot be edited, submitted or transitioned; compare-and-swap protects concurrent save. Editable data carries condition. |
| `lib/validations/listing.ts`; `lib/listings/revisions.ts`; `lib/listings/revision-preview.ts` | Create defaults Used; update explicitly preserves omitted condition. Revisions clone/apply condition; moderator comparison exposes changes. Approved/manual condition clears uncertainty. |
| `app/(public)/sell/create-listing-form.tsx`; `app/(public)/sell/create-listing-submit.ts`; `app/(public)/sell/use-create-listing-local-draft.ts`; `app/(public)/sell/listing-unsaved-draft.ts` | Condition selection, payload, device-local save/recovery and backwards-compatible defaults. |
| `lib/search/search-url.ts`; `app/(public)/search/page.tsx`; `app/api/search/route.ts`; `components/marketplace/search/search-controls.tsx`; `components/marketplace/search/listing-results-client.tsx` | Validated cross-category condition filter, server/API parity, reset/history state and card propagation. |
| `components/marketplace/listing-card.tsx`; `app/(public)/dealers/[slug]/page.tsx`; `app/(public)/page.tsx`; `components/marketplace/home/featured-listings-carousel.tsx` | New/Used labels, dealer condition filter including empty results, homepage browse links and carousel condition. |
| `app/(public)/listings/[id]/page.tsx`; `lib/seo/listing-json-ld.ts` | Primary vehicle condition, related cards, review comparison and authoritative structured-data condition. Shared file also has coordinator's source-link work. |
| `app/(admin)/admin/listings/page.tsx`; `components/admin/admin-listing-filters.tsx` | New/Used/needs-review filter, pagination state and visible uncertainty marker. Shared files also contain coordinator's Featured filter. |
| `lib/dealer-stock-sync/types.ts`; `scripts/dealer-stock-sync/types.ts`; `scripts/dealer-stock-sync/map-listing.ts`; `scripts/dealer-stock-sync/to-inventory.ts` | Optional source condition preserved. Missing evidence is not silently converted into an authoritative stock update. Explicit source labels beat route classification. Connector worker also edits source types. |
| `lib/dealer-stock-sync/plan.ts`; `lib/dealer-stock-sync/apply.ts`; `lib/dealer-stock-sync/snapshot.ts`; `scripts/dealer-stock-sync/identity.ts` | Create condition and evidence flag; condition-only reviewed updates; previous-value CAS; fingerprints/content hash include condition. |
| `lib/dealer-stock-sync/draft-transfer.ts`; `lib/dealer-stock-sync/review-edit.ts`; `scripts/dealer-stock-sync/live-review-evidence.ts`; `scripts/dealer-stock-sync/reviewed-source.ts`; `app/(admin)/admin/dealers/[dealerId]/stock-sync/review-panel.tsx` | Preserve condition through review correction, reviewed inventory, received draft/revision and visible stock approval change. |
| `lib/preview-packs/materialize.ts` | Preview listings copy source condition; missing evidence retains review flag. |
| `lib/listings/condition.ts`; `scripts/backfill-vehicle-condition.ts` | Explicit metadata/stock-route classifier. Staging-only dry-run and optimistic-concurrency apply; audit JSON first. No mileage, year, title, cars_new.html or generic source-key guesses. Latest archive observation is used; conflicting evidence stays flagged. <=10 uncertain held; larger uncertain set Used flagged per approved plan. |
| `__tests__/lib/delete-draft.test.ts`; `__tests__/lib/vehicle-condition.test.ts`; `__tests__/lib/dealer-stock-sync/rules.test.ts`; `__tests__/lib/dealer-stock-sync/apply.test.ts`; `__tests__/lib/listing-photo-mutation.test.ts`; `__tests__/scripts/dealer-stock-sync/map-listing.test.ts` | Regression coverage for ownership/status/revision/history/cleanup, explicit evidence, omitted update condition, filters, moderation differences, condition-only changes and CAS. |

## Checks

- Draft deletion and account/stock-discard regression run: 32 tests passed.
- First combined condition/deletion/revision/persistence run: 71 tests passed across 7 files.
- Search controls, account actions, archive imports and condition/stock rules: 59 tests passed across 7 files.
- Final condition route/evidence and archive import/stock plan/apply run: 36 tests passed across 4 files.
- Review correction, reviewed source, condition and deletion follow-up: 35 tests passed across 4 files.
- Final archive-photo guard, New stock mapper and apply regression: 38 tests passed across 3 files.
- `git diff --check` passed.
- Shared `npm run typecheck` passed at 17:56 UTC, including completed connector type edits. A subsequent owner-archive photo mutation guard remains covered by the release coordinator final gate.

Counts overlap; they are run receipts, not unique test totals. Tests ran with TMP/TEMP set to the authorised Windows user temp directory.

## Focused risk review

- Old creation callers receive Used; partial update callers do not reset existing New. Old local drafts recover as Used.
- Unknown source condition must not overwrite an existing New listing; source labels are authoritative and condition changes require reviewed apply.
- Administrative correction previously rebuilt stock create actions; condition is now explicitly preserved through that route and received-draft handoff.
- Retained paid/claimed drafts are archived, not hard deleted, and cannot re-enter the lifecycle. Physical deletion is restricted to unused drafts; shared images are not queued for removal.
- Existing dealer defaults are review flags, not proof of condition. Backfill scans structured attributes and saved route metadata; uncertain rows remain visible to admin review.
- Explicit New stock may omit unknown year/mileage; mapper omits those attributes and reviewed apply exempts only those two required fields. Used incomplete stock remains held.
- Manual staging acceptance remains necessary for responsive layouts, dealer/private deletion, payment callback interactions, new dealer inventory and backfill inspection.
