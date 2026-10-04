-- Additive ImageKit identity fields. Existing Cloudinary ids, URLs, versions,
-- focal points, dimensions, ordering, and the CLOUDINARY default stay in place.
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
