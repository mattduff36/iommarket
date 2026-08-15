# Listing lifecycle contract (`lst_contract`)

Workstream: `ws_7f3c9a21`  
Architecture gate 1: BLOCK. This document is the revised contract incorporating required adjustments.

## Persistence

- Add `ListingStatus.REJECTED`. Keep `APPROVED` readable; never write it after switch.
- Add `Listing.lifecycleRevision Int @default(0)`.
- Additive nullable `ListingStatusEvent` fields: `action`, `reasonCode`, `reportId` (FK, `ON DELETE SET NULL`, indexed), `notes` remains.
- No hard-delete of listings, payments, reports, events, or users in this programme’s routine paths.

## Complete action set (no ellipsis)

| Action | From | To | Reason required |
| --- | --- | --- | --- |
| SUBMIT | DRAFT, TAKEN_DOWN, REJECTED | PENDING | no |
| SUBMIT_REVISION | LIVE | LIVE | no |
| APPROVE_REVISION | LIVE | LIVE | no |
| REJECT_REVISION | LIVE | LIVE | yes |
| APPROVE | PENDING, APPROVED | LIVE | no |
| REJECT | PENDING | REJECTED | yes |
| TAKE_DOWN | LIVE, APPROVED | TAKEN_DOWN | yes |
| EXPIRE | LIVE | EXPIRED | no |
| MARK_SOLD | LIVE | SOLD | no |
| RENEW | EXPIRED | DRAFT | no |
| REINSTATE_LIVE | TAKEN_DOWN | LIVE | yes |
| RETURN_TO_DRAFT | TAKEN_DOWN, REJECTED | DRAFT | yes |
| ACCOUNT_DISABLE | LIVE, APPROVED | TAKEN_DOWN | yes |
| ACCOUNT_DISABLE_PENDING | PENDING | REJECTED | yes |

DRAFT listings stay DRAFT on account disable (already non-public). SOLD is terminal.

Reason codes: `FRAUD`, `PROHIBITED`, `MISLEADING`, `DUPLICATE`, `POLICY`, `SAFETY`, `ACCOUNT_DISABLED`, `OTHER`.  
`OTHER` requires trimmed non-empty notes. Internal notes are never shown on owner surfaces.

## Transition service

- All production status writes go through `transitionListingStatus`.
- Callers pass `expectedRevision` and intended `action`.
- Atomic CAS: `updateMany({ id, status: fromStatus, lifecycleRevision })` then increment revision.
- No arbitrary `additionalData`. Allowed effects only: `expiresAt`, `soldAt`, `featured=false` on takedown/reject.
- Same-status content edits of a LIVE listing are stored as a `ListingRevision` and recorded with `SUBMIT_REVISION`, `APPROVE_REVISION`, or `REJECT_REVISION`. Those events keep `fromStatus = toStatus = LIVE` and increment `lifecycleRevision`.
- Owners may edit `TAKEN_DOWN` and `REJECTED` listings in place and `SUBMIT` them back to `PENDING` without a new charge when a succeeded listing payment, matching free-listing claim, or active dealer entitlement exists.
- Formerly-live resubmissions preserve remaining `expiresAt`. Expired formerly-live listings must renew before resubmit.
- Seller emails fire after commit for real status changes. Internal notes are never included.
- Invalid, stale, or ABA revisions throw and write nothing.

## Reinstate live

Allowed only when all are true atomically:
- current status is `TAKEN_DOWN`
- `expiresAt` is non-null and `> now`
- history contains a prior `LIVE` status (`fromStatus` or `toStatus`)

Otherwise only `RETURN_TO_DRAFT` is offered.

## Backfill

- `APPROVED` + future `expiresAt` → `LIVE`; else → `PENDING`. Write SYSTEM backfill events.
- `TAKEN_DOWN` → `REJECTED` only when the latest inbound event is exactly `PENDING → TAKEN_DOWN`. Otherwise remain `TAKEN_DOWN`.
- Ambiguous rows are never guessed.
- Rollback mapping if old code is redeployed: `REJECTED → TAKEN_DOWN`.

## Visibility (same wave as REJECTED)

Shared predicate:
- Public: `LIVE` and not expired, or `SOLD`
- Owner or admin: all statuses, read-only for terminal/moderated
- Everyone else: notFound for DRAFT, PENDING, APPROVED, EXPIRED, REJECTED, TAKEN_DOWN

Applies to detail body, metadata/OpenGraph, favourites links, contact/report/favourite actions.

## Atomicity

CAS mutation, `ListingStatusEvent`, optional report linkage, and `AdminAuditLog` (admin actions only) occur in one transaction. Any failure rolls all four back.

## Authorization by action

| Action | Allowed actor | Source |
| --- | --- | --- |
| SUBMIT, SUBMIT_REVISION | listing owner | USER or PAYMENT |
| APPROVE, REJECT, TAKE_DOWN, REINSTATE_LIVE, RETURN_TO_DRAFT, APPROVE_REVISION, REJECT_REVISION | ADMIN | ADMIN |
| EXPIRE | system | SYSTEM |
| MARK_SOLD, RENEW | listing owner | USER |
| ACCOUNT_DISABLE, ACCOUNT_DISABLE_PENDING | ADMIN or listing owner (self-deactivate) | ADMIN or USER |

## Report linkage

`reportId`, when present, must belong to the same listing. Validated inside the transition transaction. `ON DELETE SET NULL`.

## Action effects

| Action | Effects |
| --- | --- |
| APPROVE | `expiresAt = now + 60 days` |
| REJECT, TAKE_DOWN, ACCOUNT_DISABLE, ACCOUNT_DISABLE_PENDING | `featured = false` |
| MARK_SOLD | `soldAt = now` |
| RENEW | `expiresAt = null` |
| REINSTATE_LIVE, SUBMIT, EXPIRE, RETURN_TO_DRAFT | no extra field writes except RETURN_TO_DRAFT sets `featured = false` |

## Migrations

1. Enum/column expansion only (`REJECTED`, `lifecycleRevision`, event fields).
2. Separate backfill migration. Backfill event `action = SYSTEM_BACKFILL`. Latest inbound event is `createdAt DESC, id DESC`.

## Retention

Routine admin delete is reversible soft-delete: set `deletedAt` + `deletionReason`. Do not anonymise PII in this slice. Do not delete the external auth identity. Do not delete payments, reports, listings, or audit rows. Restore clears `deletedAt`.
