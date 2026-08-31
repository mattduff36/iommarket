-- Preview packs are admin-only marketplace listings. Fail-closed: never LIVE.

ALTER TYPE "ListingStatus" ADD VALUE IF NOT EXISTS 'ADMIN_PREVIEW';

ALTER TABLE "DealerProfile" ADD COLUMN "isAdminPreview" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "DealerPreviewPack" (
    "id" TEXT NOT NULL,
    "dealerKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "sourceRunId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dealerProfileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealerPreviewPack_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DealerPreviewPack_dealerKey_key" ON "DealerPreviewPack"("dealerKey");
CREATE UNIQUE INDEX "DealerPreviewPack_dealerProfileId_key" ON "DealerPreviewPack"("dealerProfileId");
CREATE INDEX "DealerPreviewPack_enabled_idx" ON "DealerPreviewPack"("enabled");

ALTER TABLE "DealerPreviewPack" ADD CONSTRAINT "DealerPreviewPack_dealerProfileId_fkey" FOREIGN KEY ("dealerProfileId") REFERENCES "DealerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Listing" ADD COLUMN "previewPackId" TEXT;
CREATE INDEX "Listing_previewPackId_idx" ON "Listing"("previewPackId");
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_previewPackId_fkey" FOREIGN KEY ("previewPackId") REFERENCES "DealerPreviewPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."DealerPreviewPack" ENABLE ROW LEVEL SECURITY;
