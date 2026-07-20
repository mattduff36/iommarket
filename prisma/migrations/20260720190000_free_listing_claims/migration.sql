-- A durable claim is the authoritative free-listing counter. The unique
-- constraints enforce one claim per account and per listing.
CREATE TABLE "FreeListingClaim" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FreeListingClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FreeListingClaim_userId_key" ON "FreeListingClaim"("userId");
CREATE UNIQUE INDEX "FreeListingClaim_listingId_key" ON "FreeListingClaim"("listingId");

ALTER TABLE "FreeListingClaim"
  ADD CONSTRAINT "FreeListingClaim_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FreeListingClaim"
  ADD CONSTRAINT "FreeListingClaim_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve existing one-free-listing-per-account decisions. A non-draft,
-- unpaid private listing is a historical claim under the former policy.
INSERT INTO "FreeListingClaim" ("id", "userId", "listingId", "createdAt")
SELECT
  CONCAT('legacy_free_', MD5(legacy_claim."userId")),
  legacy_claim."userId",
  legacy_claim."listingId",
  legacy_claim."createdAt"
FROM (
  SELECT DISTINCT ON (listing."userId")
    listing."userId",
    listing."id" AS "listingId",
    listing."createdAt"
  FROM "Listing" AS listing
  WHERE listing."dealerId" IS NULL
    AND listing."status" <> 'DRAFT'
    AND NOT EXISTS (
      SELECT 1
      FROM "Payment" AS payment
      WHERE payment."listingId" = listing."id"
        AND payment."type" = 'LISTING'
        AND payment."status" = 'SUCCEEDED'
    )
  ORDER BY listing."userId", listing."createdAt", listing."id"
) AS legacy_claim
ON CONFLICT ("userId") DO NOTHING;
