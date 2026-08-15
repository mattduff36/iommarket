-- Additive: listing revisions, revision image/attribute snapshots, and revision lifecycle actions.

ALTER TYPE "ListingLifecycleAction" ADD VALUE IF NOT EXISTS 'SUBMIT_REVISION';
ALTER TYPE "ListingLifecycleAction" ADD VALUE IF NOT EXISTS 'APPROVE_REVISION';
ALTER TYPE "ListingLifecycleAction" ADD VALUE IF NOT EXISTS 'REJECT_REVISION';

CREATE TYPE "ListingRevisionStatus" AS ENUM (
  'DRAFT',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'DISCARDED'
);

CREATE TABLE "ListingRevision" (
  "id" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "price" INTEGER NOT NULL,
  "categoryId" TEXT NOT NULL,
  "regionId" TEXT NOT NULL,
  "trustDeclarationAccepted" BOOLEAN NOT NULL DEFAULT false,
  "trustDeclarationAcceptedAt" TIMESTAMP(3),
  "status" "ListingRevisionStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 0,
  "reasonCode" "ListingModerationReason",
  "notes" TEXT,
  "submittedAt" TIMESTAMP(3),
  "decidedAt" TIMESTAMP(3),
  "decidedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ListingRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ListingRevisionImage" (
  "id" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "provider" "ListingImageProvider" NOT NULL DEFAULT 'CLOUDINARY',
  "assetId" TEXT,
  "version" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "format" TEXT,
  "bytes" INTEGER,
  "uploadIntentId" TEXT,
  "focalX" DOUBLE PRECISION,
  "focalY" DOUBLE PRECISION,

  CONSTRAINT "ListingRevisionImage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ListingRevisionAttributeValue" (
  "id" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "attributeDefinitionId" TEXT NOT NULL,
  "value" TEXT NOT NULL,

  CONSTRAINT "ListingRevisionAttributeValue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ListingRevision_open_listingId_key"
ON "ListingRevision" ("listingId")
WHERE "status" IN ('DRAFT', 'PENDING');

CREATE INDEX "ListingRevision_listingId_status_idx" ON "ListingRevision"("listingId", "status");
CREATE INDEX "ListingRevision_status_submittedAt_idx" ON "ListingRevision"("status", "submittedAt");
CREATE INDEX "ListingRevision_decidedByUserId_idx" ON "ListingRevision"("decidedByUserId");

CREATE UNIQUE INDEX "ListingRevisionImage_uploadIntentId_key" ON "ListingRevisionImage"("uploadIntentId");
CREATE UNIQUE INDEX "ListingRevisionImage_revisionId_order_key" ON "ListingRevisionImage"("revisionId", "order");
CREATE UNIQUE INDEX "ListingRevisionImage_revisionId_provider_publicId_key" ON "ListingRevisionImage"("revisionId", "provider", "publicId");
CREATE INDEX "ListingRevisionImage_revisionId_idx" ON "ListingRevisionImage"("revisionId");
CREATE INDEX "ListingRevisionImage_provider_publicId_idx" ON "ListingRevisionImage"("provider", "publicId");

CREATE UNIQUE INDEX "ListingRevisionAttributeValue_revisionId_attributeDefinitionId_key"
ON "ListingRevisionAttributeValue"("revisionId", "attributeDefinitionId");
CREATE INDEX "ListingRevisionAttributeValue_attributeDefinitionId_value_idx"
ON "ListingRevisionAttributeValue"("attributeDefinitionId", "value");

ALTER TABLE "ListingRevision"
  ADD CONSTRAINT "ListingRevision_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ListingRevision"
  ADD CONSTRAINT "ListingRevision_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ListingRevision"
  ADD CONSTRAINT "ListingRevision_regionId_fkey"
  FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ListingRevision"
  ADD CONSTRAINT "ListingRevision_decidedByUserId_fkey"
  FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ListingRevisionImage"
  ADD CONSTRAINT "ListingRevisionImage_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "ListingRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ListingRevisionImage"
  ADD CONSTRAINT "ListingRevisionImage_uploadIntentId_fkey"
  FOREIGN KEY ("uploadIntentId") REFERENCES "ListingImageUploadIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ListingRevisionAttributeValue"
  ADD CONSTRAINT "ListingRevisionAttributeValue_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "ListingRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ListingRevisionAttributeValue"
  ADD CONSTRAINT "ListingRevisionAttributeValue_attributeDefinitionId_fkey"
  FOREIGN KEY ("attributeDefinitionId") REFERENCES "AttributeDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
