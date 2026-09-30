ALTER TABLE "Listing" ADD COLUMN "approvedAt" TIMESTAMP(3);

CREATE INDEX "Listing_approvedAt_idx" ON "Listing"("approvedAt");

UPDATE "Listing" AS listing
SET "approvedAt" = first_approval."approvedAt"
FROM (
  SELECT "listingId", MIN("createdAt") AS "approvedAt"
  FROM "ListingStatusEvent"
  WHERE "source" = 'ADMIN'
    AND "action" = 'APPROVE'
  GROUP BY "listingId"
) AS first_approval
WHERE listing."id" = first_approval."listingId"
  AND listing."approvedAt" IS NULL;
