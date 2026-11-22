CREATE TYPE "VehicleCondition" AS ENUM ('NEW', 'USED');
ALTER TABLE "Listing" ADD COLUMN "condition" "VehicleCondition" NOT NULL DEFAULT 'USED';
ALTER TABLE "ListingRevision" ADD COLUMN "condition" "VehicleCondition" NOT NULL DEFAULT 'USED';
CREATE INDEX "Listing_condition_status_idx" ON "Listing"("condition", "status");

ALTER TABLE "Listing" ADD COLUMN "conditionReviewRequired" BOOLEAN NOT NULL DEFAULT false;
-- Existing dealer inventory requires source evidence before classifying as new.
UPDATE "Listing" SET "conditionReviewRequired" = true WHERE "userId" IN (SELECT "userId" FROM "DealerProfile");
