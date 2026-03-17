-- CreateEnum
CREATE TYPE "ListingStatusEventSource" AS ENUM ('USER', 'ADMIN', 'SYSTEM');

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "avatarUrl" TEXT,
ADD COLUMN "bio" TEXT,
ADD COLUMN "deletionReason" TEXT,
ADD COLUMN "deletionRequestedAt" TIMESTAMP(3),
ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "phone" TEXT;

-- CreateTable
CREATE TABLE "ListingStatusEvent" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "fromStatus" "ListingStatus",
    "toStatus" "ListingStatus" NOT NULL,
    "changedByUserId" TEXT,
    "source" "ListingStatusEventSource" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ListingStatusEvent_listingId_createdAt_idx" ON "ListingStatusEvent"("listingId", "createdAt");

-- CreateIndex
CREATE INDEX "ListingStatusEvent_changedByUserId_createdAt_idx" ON "ListingStatusEvent"("changedByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ListingStatusEvent_toStatus_createdAt_idx" ON "ListingStatusEvent"("toStatus", "createdAt");

-- AddForeignKey
ALTER TABLE "ListingStatusEvent" ADD CONSTRAINT "ListingStatusEvent_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingStatusEvent" ADD CONSTRAINT "ListingStatusEvent_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
