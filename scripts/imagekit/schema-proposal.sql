-- Proposed development schema. Not applied.
-- The configured database is the shared development project syneonzucehwlghqmfbg.
-- Applying this from an unmerged branch would diverge prisma migration history
-- for every other staging checkout. Apply only with that branch's migration
-- history, after a dry-run of scripts/imagekit/backfill-dev.ts.

ALTER TYPE "ListingImageProvider" ADD VALUE IF NOT EXISTS 'IMAGEKIT';

ALTER TABLE "ListingImage"
  ADD COLUMN IF NOT EXISTS "imageKitFileId" TEXT,
  ADD COLUMN IF NOT EXISTS "imageKitFilePath" TEXT;

ALTER TABLE "ListingRevisionImage"
  ADD COLUMN IF NOT EXISTS "imageKitFileId" TEXT,
  ADD COLUMN IF NOT EXISTS "imageKitFilePath" TEXT;

ALTER TABLE "ListingImageUploadIntent"
  ADD COLUMN IF NOT EXISTS "imageKitFileId" TEXT,
  ADD COLUMN IF NOT EXISTS "imageKitFilePath" TEXT;

ALTER TABLE "ListingImageCleanupJob"
  ADD COLUMN IF NOT EXISTS "imageKitFileId" TEXT,
  ADD COLUMN IF NOT EXISTS "imageKitFilePath" TEXT;
