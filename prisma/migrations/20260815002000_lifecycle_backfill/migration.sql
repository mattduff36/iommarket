-- Conservative backfill. Ambiguous TAKEN_DOWN rows stay TAKEN_DOWN.
-- Rollback mapping if old application code is redeployed: REJECTED -> TAKEN_DOWN.

WITH approved_to_live AS (
  UPDATE "Listing"
  SET status = 'LIVE'
  WHERE status = 'APPROVED'
    AND "expiresAt" IS NOT NULL
    AND "expiresAt" > NOW()
  RETURNING id
)
INSERT INTO "ListingStatusEvent" (
  "id",
  "listingId",
  "fromStatus",
  "toStatus",
  "source",
  "action",
  "notes",
  "createdAt"
)
SELECT
  'cbackfill_live_' || approved_to_live.id,
  approved_to_live.id,
  'APPROVED',
  'LIVE',
  'SYSTEM',
  'SYSTEM_BACKFILL',
  'Backfill: unused APPROVED status with future expiry mapped to LIVE',
  NOW()
FROM approved_to_live;

WITH approved_to_pending AS (
  UPDATE "Listing"
  SET status = 'PENDING'
  WHERE status = 'APPROVED'
  RETURNING id
)
INSERT INTO "ListingStatusEvent" (
  "id",
  "listingId",
  "fromStatus",
  "toStatus",
  "source",
  "action",
  "notes",
  "createdAt"
)
SELECT
  'cbackfill_pend_' || approved_to_pending.id,
  approved_to_pending.id,
  'APPROVED',
  'PENDING',
  'SYSTEM',
  'SYSTEM_BACKFILL',
  'Backfill: unused APPROVED status without future expiry mapped to PENDING',
  NOW()
FROM approved_to_pending;

WITH taken_down_to_rejected AS (
  UPDATE "Listing" l
  SET status = 'REJECTED'
  WHERE l.status = 'TAKEN_DOWN'
    AND (
      SELECT e."fromStatus"
      FROM "ListingStatusEvent" e
      WHERE e."listingId" = l.id
        AND e."toStatus" = 'TAKEN_DOWN'
      ORDER BY e."createdAt" DESC, e.id DESC
      LIMIT 1
    ) = 'PENDING'
  RETURNING id
)
INSERT INTO "ListingStatusEvent" (
  "id",
  "listingId",
  "fromStatus",
  "toStatus",
  "source",
  "action",
  "notes",
  "createdAt"
)
SELECT
  'cbackfill_rej_' || taken_down_to_rejected.id,
  taken_down_to_rejected.id,
  'TAKEN_DOWN',
  'REJECTED',
  'SYSTEM',
  'SYSTEM_BACKFILL',
  'Backfill: latest inbound event was PENDING -> TAKEN_DOWN',
  NOW()
FROM taken_down_to_rejected;
