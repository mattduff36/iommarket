-- Waitlist early-access campaign. Additive only: existing waitlist rows stay in place.

CREATE TYPE "WaitlistEarlyAccessCampaignStatus" AS ENUM (
  'DRAFT',
  'QUEUED',
  'SENDING',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE "WaitlistEarlyAccessDeliveryStatus" AS ENUM (
  'PENDING',
  'SENDING',
  'SENT',
  'FAILED',
  'SKIPPED'
);

CREATE TABLE "WaitlistEarlyAccessCampaign" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "bodyText" TEXT NOT NULL,
  "status" "WaitlistEarlyAccessCampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "createdByAdminId" TEXT NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "confirmedByAdminId" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "recipientTotal" INTEGER NOT NULL DEFAULT 0,
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WaitlistEarlyAccessCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WaitlistEarlyAccessRecipient" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "waitlistUserId" TEXT,
  "testAdminUserId" TEXT,
  "nonce" TEXT NOT NULL,
  "deliveryStatus" "WaitlistEarlyAccessDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "resendMessageId" TEXT,
  "sentAt" TIMESTAMP(3),
  "skippedReason" TEXT,
  "nextAttemptAt" TIMESTAMP(3),
  "claimedAt" TIMESTAMP(3),
  "claimLeaseExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WaitlistEarlyAccessRecipient_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WaitlistEarlyAccessRecipient_subject_check" CHECK (
    ("waitlistUserId" IS NOT NULL AND "testAdminUserId" IS NULL)
    OR ("waitlistUserId" IS NULL AND "testAdminUserId" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "WaitlistEarlyAccessCampaign_key_key"
ON "WaitlistEarlyAccessCampaign"("key");

CREATE INDEX "WaitlistEarlyAccessCampaign_status_createdAt_idx"
ON "WaitlistEarlyAccessCampaign"("status", "createdAt");

CREATE UNIQUE INDEX "WaitlistEarlyAccessRecipient_campaignId_waitlistUserId_key"
ON "WaitlistEarlyAccessRecipient"("campaignId", "waitlistUserId");

CREATE UNIQUE INDEX "WaitlistEarlyAccessRecipient_campaignId_testAdminUserId_key"
ON "WaitlistEarlyAccessRecipient"("campaignId", "testAdminUserId");

CREATE INDEX "WaitlistEarlyAccessRecipient_deliveryStatus_nextAttemptAt_idx"
ON "WaitlistEarlyAccessRecipient"("deliveryStatus", "nextAttemptAt");

CREATE INDEX "WaitlistEarlyAccessRecipient_campaignId_deliveryStatus_idx"
ON "WaitlistEarlyAccessRecipient"("campaignId", "deliveryStatus");

CREATE INDEX "WaitlistEarlyAccessRecipient_claimedAt_idx"
ON "WaitlistEarlyAccessRecipient"("claimedAt");

ALTER TABLE "WaitlistEarlyAccessRecipient"
ADD CONSTRAINT "WaitlistEarlyAccessRecipient_campaignId_fkey"
FOREIGN KEY ("campaignId") REFERENCES "WaitlistEarlyAccessCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WaitlistEarlyAccessRecipient"
ADD CONSTRAINT "WaitlistEarlyAccessRecipient_waitlistUserId_fkey"
FOREIGN KEY ("waitlistUserId") REFERENCES "WaitlistUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WaitlistEarlyAccessRecipient"
ADD CONSTRAINT "WaitlistEarlyAccessRecipient_testAdminUserId_fkey"
FOREIGN KEY ("testAdminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."WaitlistEarlyAccessCampaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."WaitlistEarlyAccessRecipient" ENABLE ROW LEVEL SECURITY;
