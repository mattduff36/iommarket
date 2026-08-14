-- Adaptive listing photos: metadata, upload intents, cleanup jobs, revisioned ordering.

CREATE TYPE "ListingImageProvider" AS ENUM ('CLOUDINARY', 'EXTERNAL');
CREATE TYPE "ListingImageUploadIntentStatus" AS ENUM ('ISSUED', 'VERIFIED', 'CONSUMED', 'REJECTED', 'EXPIRED');
CREATE TYPE "ListingImageCleanupJobStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

ALTER TABLE "Listing"
ADD COLUMN "photoRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastPhotoMutationId" TEXT,
ADD COLUMN "lastPhotoMutationHash" TEXT;

CREATE UNIQUE INDEX "Listing_lastPhotoMutationId_key" ON "Listing"("lastPhotoMutationId");

ALTER TABLE "ListingImage"
ADD COLUMN "provider" "ListingImageProvider" NOT NULL DEFAULT 'CLOUDINARY',
ADD COLUMN "assetId" TEXT,
ADD COLUMN "version" TEXT,
ADD COLUMN "width" INTEGER,
ADD COLUMN "height" INTEGER,
ADD COLUMN "format" TEXT,
ADD COLUMN "bytes" INTEGER,
ADD COLUMN "uploadIntentId" TEXT,
ADD COLUMN "focalX" DOUBLE PRECISION,
ADD COLUMN "focalY" DOUBLE PRECISION;

UPDATE "ListingImage"
SET "provider" = 'EXTERNAL',
    "width" = 800,
    "height" = 600,
    "format" = 'jpg'
WHERE "publicId" LIKE 'demo/%';

CREATE UNIQUE INDEX "ListingImage_listingId_order_key" ON "ListingImage"("listingId", "order");
CREATE UNIQUE INDEX "ListingImage_provider_publicId_key" ON "ListingImage"("provider", "publicId");
CREATE UNIQUE INDEX "ListingImage_uploadIntentId_key" ON "ListingImage"("uploadIntentId");

ALTER TABLE "ListingImage"
ADD CONSTRAINT "ListingImage_dimensions_positive"
CHECK (("width" IS NULL AND "height" IS NULL) OR ("width" > 0 AND "height" > 0));

ALTER TABLE "ListingImage"
ADD CONSTRAINT "ListingImage_focal_pair"
CHECK (
  ("focalX" IS NULL AND "focalY" IS NULL)
  OR (
    "focalX" IS NOT NULL
    AND "focalY" IS NOT NULL
    AND "focalX" >= 0
    AND "focalX" <= 1
    AND "focalY" >= 0
    AND "focalY" <= 1
  )
);

CREATE TABLE "ListingImageUploadIntent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" TEXT,
    "publicId" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "status" "ListingImageUploadIntentStatus" NOT NULL DEFAULT 'ISSUED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "assetId" TEXT,
    "version" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "format" TEXT,
    "bytes" INTEGER,
    "deliveryType" TEXT NOT NULL DEFAULT 'private',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingImageUploadIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ListingImageUploadIntent_publicId_key" ON "ListingImageUploadIntent"("publicId");
CREATE INDEX "ListingImageUploadIntent_userId_status_idx" ON "ListingImageUploadIntent"("userId", "status");
CREATE INDEX "ListingImageUploadIntent_expiresAt_status_idx" ON "ListingImageUploadIntent"("expiresAt", "status");

ALTER TABLE "ListingImageUploadIntent"
ADD CONSTRAINT "ListingImageUploadIntent_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ListingImageUploadIntent"
ADD CONSTRAINT "ListingImageUploadIntent_listingId_fkey"
FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ListingImage"
ADD CONSTRAINT "ListingImage_uploadIntentId_fkey"
FOREIGN KEY ("uploadIntentId") REFERENCES "ListingImageUploadIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ListingImageCleanupJob" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "deliveryType" TEXT NOT NULL DEFAULT 'private',
    "reason" TEXT NOT NULL,
    "status" "ListingImageCleanupJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ListingImageCleanupJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ListingImageCleanupJob_status_createdAt_idx" ON "ListingImageCleanupJob"("status", "createdAt");
