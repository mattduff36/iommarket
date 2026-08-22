# Admin Lifecycle Audit Register

Workstream: `ws_7f3c9a21`  
Owner decision (programme): remediate all 37 findings in classified slices.  
Confirmed restoration policy: contextual - **Reinstate live** for mistaken takedowns; **Return to draft** for seller correction.

Status values: `open` | `in_progress` | `implemented` | `verified` | `unresolved`

Programme status: **complete** (2026-08-15). Owner accepted documented residuals.

Verification: `npx tsc --noEmit` passed. Full Vitest: 411 passed, including disposable-Postgres `ALR-DAT-001` (`postgres:16` container, conservative APPROVED/TAKEN_DOWN mapping, no production migrate). Broader suite is green after a jsdom `ResizeObserver` setup stub. Playwright `ALR-E2E-001` remains unrun: the configured `DATABASE_URL` is a remote Supabase pooler, so the journey was not executed to avoid mutating that database. Public Ripple docs still do not publish a stable webhook schema; local alias mapping and subscription-refund entitlement are covered by unit tests. Closure review `[Final Diff Review](94bcec93-de2a-42d1-a8ba-bfa5407bc062)` was not re-run (two-pass limit). No third premium review was started.

---

## Listings and reports

### ALR-01 - `TAKEN_DOWN` is terminal
- **Severity:** Critical
- **Evidence:** `lib/listing-status.ts` (`TAKEN_DOWN: []`); `components/admin/listing-moderation-actions.tsx` hides actions for that status; `actions/admin.ts` maps REJECT and TAKE_DOWN to `TAKEN_DOWN`.
- **Current behaviour:** No restore/relist path. Mistaken moderation requires database intervention.
- **Impact:** Irreversible admin mistakes; no appeal/recovery UX.
- **Owner decision:** Add `TAKEN_DOWN → LIVE` (reinstate) and `TAKEN_DOWN → DRAFT` / `REJECTED → DRAFT` (return to seller).
- **Slice / lane:** `lst_contract` CRITICAL, `lst_admin` GUARDED
- **Verification:** `ALR-LST-003`, `ALR-LST-004`
- **Status:** verified

### ALR-02 - Owner View of taken-down listings 404s
- **Severity:** High
- **Evidence:** `app/(public)/listings/[id]/page.tsx` (`notFound()` unless admin); `app/(public)/account/listings/page.tsx` still links to `/listings/{id}`.
- **Current behaviour:** Owners see the row but cannot open it or the reason.
- **Impact:** No seller visibility of moderation outcome.
- **Owner decision:** Owner and admin read-only access with reason/history; public remains blocked.
- **Slice / lane:** `lst_admin` GUARDED
- **Verification:** `ALR-VIS-002`
- **Status:** verified

### ALR-03 - Reject/take-down captures no reason
- **Severity:** High
- **Evidence:** `lib/validations/listing.ts` `adminNotes` optional; `listing-moderation-actions.tsx` calls `moderateListing({ listingId, action })` only.
- **Current behaviour:** One-click adverse action; notes never sent.
- **Impact:** No structured audit or seller-facing reason.
- **Owner decision:** Required reason code + optional notes; `OTHER` requires notes.
- **Slice / lane:** `lst_contract` CRITICAL, `lst_admin` GUARDED
- **Verification:** `ALR-LST-003`
- **Status:** verified

### ALR-04 - Transition rules not enforced at runtime
- **Severity:** High
- **Evidence:** `isValidTransition` used in tests only; `lib/listings/status-events.ts` writes any `toStatus`.
- **Current behaviour:** UI-only guards; `updateListing` can force `DRAFT` from any status.
- **Impact:** Impossible states and broken history.
- **Owner decision:** Enforce in `transitionListingStatus` with atomic stale-state guard.
- **Slice / lane:** `lst_contract` CRITICAL
- **Verification:** `ALR-LST-001`, `ALR-LST-002`
- **Status:** verified

### ALR-05 - Listing moderation bypasses `AdminAuditLog`
- **Severity:** Medium
- **Evidence:** `actions/admin.ts` `moderateListing` / `setListingFeatured` never call `logAdminAction`.
- **Current behaviour:** Only optional `ListingStatusEvent.notes`.
- **Impact:** Split accountability.
- **Owner decision:** Mirror material listing actions to `AdminAuditLog`.
- **Slice / lane:** `lst_contract` CRITICAL
- **Verification:** `ALR-AUD-001`
- **Status:** verified

### ALR-06 - Admin listings capped at 50, no filters
- **Severity:** Medium
- **Evidence:** `app/(admin)/admin/listings/page.tsx` `findMany({ take: 50 })` with no `where` / searchParams.
- **Current behaviour:** Terminal listings compete for 50 slots; no archive view.
- **Impact:** Taken-down/rejected listings become invisible.
- **Owner decision:** Search, status filters, pagination, Taken down / Rejected archive.
- **Slice / lane:** `lst_admin` GUARDED
- **Verification:** `ALR-ADM-001`
- **Status:** verified

### ALR-07 - `APPROVED` listing status is unused
- **Severity:** Medium
- **Evidence:** `moderateListing` APPROVE maps to `LIVE`; no writer sets `APPROVED`.
- **Current behaviour:** Dead enum value and filter badges.
- **Owner decision:** Expand/backfill/switch/contract - keep enum during switch; migrate any rows; stop writing `APPROVED`. Contract removal is a later migration.
- **Slice / lane:** `lst_contract` CRITICAL
- **Verification:** `ALR-DAT-001`
- **Status:** verified

### ALR-08 - Reject vs take-down indistinguishable
- **Severity:** High
- **Evidence:** Both map to `TAKEN_DOWN`; action string is discarded.
- **Current behaviour:** Cannot report pre-live rejection vs post-live takedown.
- **Owner decision:** Add `REJECTED` for pre-publication; keep `TAKEN_DOWN` for previously visible listings.
- **Slice / lane:** `lst_contract` CRITICAL
- **Verification:** `ALR-LST-003`, `ALR-DAT-001`
- **Status:** verified

### ALR-09 - Reports disconnected from listing moderation
- **Severity:** Medium
- **Evidence:** `updateReportStatus` updates report only; report cards link to public listing URL.
- **Current behaviour:** ACTIONED does not change listing visibility.
- **Owner decision:** Transactional “Take down and mark actioned” with report/event linkage.
- **Slice / lane:** `mod_history` CRITICAL
- **Verification:** `ALR-RPT-001`
- **Status:** verified

### ALR-10 - DRAFT/PENDING reachable by public URL
- **Severity:** High
- **Evidence:** `app/(public)/listings/[id]/page.tsx` gates only `TAKEN_DOWN`.
- **Current behaviour:** Unpublished inventory and metadata leak to anyone with the ID.
- **Owner decision:** Non-public statuses visible only to owner/admin in page and metadata.
- **Slice / lane:** `lst_admin` GUARDED
- **Verification:** `ALR-VIS-001`
- **Status:** verified

### ALR-11 - Expiry depends on request-time sweep
- **Severity:** Medium
- **Evidence:** `lib/listings/expiry.ts` 60s in-process sweep; only image-cleanup cron exists.
- **Current behaviour:** Stale LIVE listings persist on low traffic; admin LIVE counts ignore expiry.
- **Owner decision:** Protected `/api/cron/listing-expiry`; use `liveListingWhere()` for live counts.
- **Slice / lane:** `ops_safety` CRITICAL (auth) / STANDARD (predicate reuse)
- **Verification:** `ALR-OPS-001`
- **Status:** verified

### ALR-12 - Admin disable leaves listings live
- **Severity:** High
- **Evidence:** `actions/account.ts` self-delete takes listings down; `actions/admin/users.ts` `setUserDisabled` updates user only.
- **Current behaviour:** Disabled users can remain searchable sellers.
- **Owner decision:** Bulk takedown of active listings on disable, with status events.
- **Slice / lane:** `identity_lifecycle` CRITICAL
- **Verification:** `ALR-IDN-001`
- **Status:** verified

### ALR-13 - Favourites keep dead links
- **Severity:** Medium
- **Evidence:** `app/(public)/account/favourites/page.tsx` no status filter.
- **Current behaviour:** Saved listings 404 after moderation/expiry.
- **Owner decision:** Badge unavailable listings; link only when viewable.
- **Slice / lane:** `lst_admin` GUARDED
- **Verification:** `ALR-VIS-001`
- **Status:** verified

### ALR-14 - Admin hard-delete destroys listings and history
- **Severity:** Critical
- **Evidence:** `actions/admin/users.ts` deletes payments, reports, listings, then user.
- **Current behaviour:** Financial and moderation history is destroyed.
- **Owner decision:** Routine admin delete becomes soft-delete/anonymise; retain payments/reports/listings/audit.
- **Slice / lane:** `identity_lifecycle` CRITICAL
- **Verification:** `ALR-IDN-001`
- **Status:** verified

### ALR-15 - Photo mutations ignore listing status
- **Severity:** Medium
- **Evidence:** `lib/listings/photo-mutation.ts` ownership check only.
- **Current behaviour:** LIVE/TAKEN_DOWN/SOLD photos can change without remoderation.
- **Owner decision:** Restrict mutations to editable statuses (`DRAFT`, `EXPIRED`, `REJECTED` after return-to-draft).
- **Slice / lane:** `lst_admin` GUARDED
- **Verification:** `ALR-LST-002`
- **Status:** verified

### ALR-16 - Report status changes unaudited
- **Severity:** High
- **Evidence:** `actions/admin.ts` `updateReportStatus` has no `logAdminAction`.
- **Owner decision:** Log actor, prior/new status, reportId, listingId.
- **Slice / lane:** `mod_history` CRITICAL
- **Verification:** `ALR-AUD-001`, `ALR-RPT-002`
- **Status:** verified

### ALR-17 - Report admin notes hidden
- **Severity:** Medium
- **Evidence:** `report-actions.tsx` initialises notes to `""`; page does not pass `adminNotes`.
- **Owner decision:** Preload and display saved notes (mirror reviews).
- **Slice / lane:** `mod_history` CRITICAL
- **Verification:** `ALR-RPT-002`
- **Status:** verified

### ALR-18 - Reports capped at 100, no filters
- **Severity:** Medium
- **Evidence:** `app/(admin)/admin/reports/page.tsx` `take: 100`.
- **Owner decision:** OPEN-first filters and pagination.
- **Slice / lane:** `mod_history` CRITICAL
- **Verification:** `ALR-RPT-002`
- **Status:** verified

### ALR-19 - Reporter reason unstructured
- **Severity:** Low
- **Evidence:** `reportListingSchema` free-text `reason` only.
- **Owner decision:** `reasonCode` enum + optional detail.
- **Slice / lane:** `mod_history` CRITICAL
- **Verification:** `ALR-RPT-002`
- **Status:** verified

### ALR-20 - E2E report records can leak
- **Severity:** Medium
- **Evidence:** `e2e/critical-funnels.spec.ts` creates listings/reports; cleanup is afterEach only.
- **Owner decision:** Deterministic cleanup helpers and environment guards.
- **Slice / lane:** `ops_safety` STANDARD
- **Verification:** `ALR-E2E-001`, `ALR-OPS-001`
- **Status:** implemented (Playwright journey written; runtime not executed - no safe non-production app/database target)

---

## Reviews, users, dealers, and taxonomy

### ALR-21 - Review moderation has no event history
- **Severity:** High
- **Evidence:** `actions/dealer-reviews.ts` `moderateDealerReview` overwrites status/notes; no `logAdminAction`.
- **Owner decision:** Append-only `DealerReviewModerationEvent` + audit log.
- **Slice / lane:** `mod_history` CRITICAL
- **Verification:** `ALR-REV-001`
- **Status:** verified

### ALR-22 - REJECTED vs HIDDEN review semantics unclear
- **Severity:** Low
- **Evidence:** Public queries use `APPROVED` only.
- **Owner decision:** Document in admin UI; require reason. REJECTED = never publish; HIDDEN = withdraw after approval.
- **Slice / lane:** `mod_history` CRITICAL
- **Verification:** `ALR-REV-001`
- **Status:** verified

### ALR-23 - Review resubmit clears moderation metadata
- **Severity:** Medium
- **Evidence:** upsert sets `adminNotes: null`, `moderatedAt: null`.
- **Owner decision:** Keep immutable prior events; do not null historical notes.
- **Slice / lane:** `mod_history` CRITICAL
- **Verification:** `ALR-REV-001`
- **Status:** verified

### ALR-24 - Admin reviews capped at 200, no filters
- **Severity:** Medium
- **Evidence:** `app/(admin)/admin/reviews/page.tsx` `take: 200`.
- **Owner decision:** Pending-first filters and pagination.
- **Slice / lane:** `mod_history` CRITICAL
- **Verification:** `ALR-REV-001`
- **Status:** verified

### ALR-25 - Self-deactivate is soft; admin delete is hard
- **Severity:** Critical
- **Evidence:** `actions/account.ts` vs `actions/admin/users.ts` deleteUser.
- **Owner decision:** Unify on reversible soft-delete; restore action; hard purge is out of routine scope.
- **Slice / lane:** `identity_lifecycle` CRITICAL
- **Verification:** `ALR-IDN-001`
- **Status:** verified

### ALR-26 - Soft-deleted users look active in admin
- **Severity:** Medium
- **Evidence:** `app/(admin)/admin/users/page.tsx` no `deletedAt` badge/filter.
- **Owner decision:** Status badges, filters, restore controls, show `deletionReason`.
- **Slice / lane:** `identity_lifecycle` CRITICAL
- **Verification:** `ALR-IDN-001`
- **Status:** verified

### ALR-27 - User disable has no useful reason
- **Severity:** Medium
- **Evidence:** UI never collects reason; defaults to `"Disabled by admin"`.
- **Owner decision:** Required structured reason + optional detail.
- **Slice / lane:** `identity_lifecycle` CRITICAL
- **Verification:** `ALR-IDN-001`
- **Status:** verified

### ALR-28 - Dealer demotion leaves entitlements
- **Severity:** High
- **Evidence:** `setUserRole` / `downgradeDealerToUser` update role only.
- **Owner decision:** Transactionally revoke grants and mark subscriptions cancel-at-period-end / local cancelled as policy allows.
- **Slice / lane:** `identity_lifecycle` CRITICAL
- **Verification:** `ALR-IDN-001`
- **Status:** verified

### ALR-29 - Dealer downgrade confirm closes early
- **Severity:** Low
- **Evidence:** `dealer-actions.tsx` closes confirm immediately.
- **Owner decision:** Keep dialog until success/error.
- **Slice / lane:** `small_ux` FAST
- **Verification:** focused component test
- **Status:** verified

### ALR-30 - Inactive category/region does not hide existing listings
- **Severity:** High
- **Evidence:** create UI filters `active: true`; `createListing` does not; search shows LIVE regardless.
- **Owner decision:** Server-side `active` checks; existing LIVE listings remain until expiry/moderation (do not auto-destroy); warn with count on deactivate.
- **Slice / lane:** `taxonomy_lifecycle` CRITICAL (if schema) / STANDARD (queries)
- **Verification:** `ALR-TAX-001`
- **Status:** verified

### ALR-31 - Category/attribute mutations unaudited
- **Severity:** Medium
- **Evidence:** `deleteAttributeDefinition`, `toggleCategoryActive`, `deleteCategory` skip `logAdminAction`.
- **Owner decision:** Audit all taxonomy mutations; prefer deactivate over delete.
- **Slice / lane:** `taxonomy_lifecycle` STANDARD
- **Verification:** `ALR-AUD-001`
- **Status:** verified

---

## Payments, content, media, waitlist, monitoring, operations

### ALR-32 - Cancel-at-period-end stays locally ACTIVE
- **Severity:** High
- **Evidence:** `actions/admin/payments.ts` updates local status only when `immediately: true`.
- **Owner decision:** Persist `cancelAtPeriodEnd` (and period end); reconcile via webhook.
- **Slice / lane:** `payment_reconcile` CRITICAL
- **Verification:** `ALR-PAY-001`
- **Status:** verified

### ALR-33 - Refunds lack local reconciliation and reason
- **Severity:** Medium
- **Evidence:** refund hits provider only; schema/UI have no required reason.
- **Owner decision:** Required refund reason; local refund record; entitlement update; audit details.
- **Slice / lane:** `payment_reconcile` CRITICAL
- **Verification:** `ALR-PAY-001`
- **Status:** verified

### ALR-34 - Waitlist delete irreversible and unaudited
- **Severity:** Medium
- **Evidence:** `actions/waitlist.ts` hard delete; no audit.
- **Owner decision:** Soft-delete + `logAdminAction`.
- **Slice / lane:** `content_recovery` CRITICAL
- **Verification:** `ALR-CMS-001`
- **Status:** verified

### ALR-35 - CMS unpublish/delete and live media deletion
- **Severity:** Medium
- **Evidence:** `publishedAt` set only on publish (`undefined` on draft); `deleteContentPage` hard-deletes; `actions/admin/media.ts` deletes LIVE images.
- **Owner decision:** Clear `publishedAt` on unpublish; soft-delete pages; block LIVE image delete unless listing is non-public or reason recorded.
- **Slice / lane:** `content_recovery` CRITICAL / STANDARD
- **Verification:** `ALR-CMS-001`
- **Status:** verified

### ALR-36 - Monitoring mute expiry stale
- **Severity:** Medium
- **Evidence:** alerts respect `mutedUntil`; status stays MUTED until manual reopen.
- **Owner decision:** Treat expired mute as OPEN in queries; optional cron reopen; append status events.
- **Slice / lane:** `monitoring_audit` CRITICAL (events) / GUARDED (viewer)
- **Verification:** `ALR-MON-001`
- **Status:** verified

### ALR-37 - Audit log write-only; seed/dev unsafe
- **Severity:** High
- **Evidence:** `AdminAuditLog` has no admin UI; seed prints credentials and incomplete cleanup; `dev-bypass` gated only by `NODE_ENV`.
- **Owner decision:** `/admin/audit` viewer; complete `logAdminAction` coverage; production-guard seed/dev; no credential logging; comprehensive cleanup.
- **Slice / lane:** `monitoring_audit` GUARDED + `ops_safety` CRITICAL
- **Verification:** `ALR-AUD-001`, `ALR-OPS-001`
- **Status:** verified

---

## Slice map

| Slice | Lane | Findings |
| --- | --- | --- |
| `lst_contract` | CRITICAL | 01, 03, 04, 05, 07, 08 |
| `lst_admin` | GUARDED | 02, 06, 10, 13, 15 |
| `mod_history` | CRITICAL | 09, 16–19, 21–24 |
| `identity_lifecycle` | CRITICAL | 12, 14, 25–28 |
| `payment_reconcile` | CRITICAL | 32, 33 |
| `taxonomy_lifecycle` | STANDARD/CRITICAL | 30, 31 |
| `content_recovery` | STANDARD/CRITICAL | 34, 35 |
| `monitoring_audit` | CRITICAL/GUARDED | 36, 37 (viewer) |
| `ops_safety` | CRITICAL/STANDARD | 11, 20, 37 (seed/dev) |
| `small_ux` | FAST | 29 |
