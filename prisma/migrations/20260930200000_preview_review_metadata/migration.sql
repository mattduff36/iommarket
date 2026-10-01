-- Additive metadata for the admin-only preview-pack review workflow.
CREATE TYPE "PreviewReviewState" AS ENUM ('NONE', 'NEEDS_REVIEW');

ALTER TABLE "DealerPreviewPack"
ADD COLUMN "reviewState" "PreviewReviewState" NOT NULL DEFAULT 'NONE',
ADD COLUMN "reviewReasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "reviewSourceRunId" TEXT;

ALTER TABLE "Listing"
ADD COLUMN "reviewState" "PreviewReviewState" NOT NULL DEFAULT 'NONE',
ADD COLUMN "reviewReasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "reviewSourceIdentity" TEXT,
ADD COLUMN "reviewSourceUrl" TEXT;

CREATE INDEX "DealerPreviewPack_reviewState_idx" ON "DealerPreviewPack"("reviewState");
CREATE INDEX "Listing_reviewState_idx" ON "Listing"("reviewState");
CREATE INDEX "Listing_reviewSourceIdentity_idx" ON "Listing"("reviewSourceIdentity");

CREATE UNIQUE INDEX "Listing_previewPackId_reviewSourceIdentity_key"
ON "Listing"("previewPackId", "reviewSourceIdentity");
