-- Dealer launch onboarding. Additive only: existing grants and users stay in place.
-- Case-insensitive user emails are checked before the new unique index is created.

DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT lower("email")
    FROM "User"
    GROUP BY lower("email")
    HAVING count(*) > 1
  ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Refusing dealer onboarding migration: % case-insensitive duplicate user emails exist.', duplicate_count;
  END IF;
END $$;

CREATE UNIQUE INDEX "User_email_lower_key" ON "User" (lower("email"));

ALTER TYPE "PolicyAcceptanceSource" ADD VALUE IF NOT EXISTS 'ONBOARDING';

CREATE TYPE "DealerOnboardingInviteStatus" AS ENUM (
  'SEND_FAILED',
  'SENT',
  'CLAIMING',
  'FINALIZING_AUTH',
  'COMPLETED',
  'REVOKED',
  'EXPIRED'
);

CREATE TABLE "DealerPromotionCampaign" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "tier" "DealerTier" NOT NULL DEFAULT 'PRO',
  "createdByAdminId" TEXT NOT NULL,
  "lockedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DealerPromotionCampaign_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DealerPromotionCampaign_window_check" CHECK ("endsAt" > "startsAt")
);

CREATE UNIQUE INDEX "DealerPromotionCampaign_key_key" ON "DealerPromotionCampaign"("key");
CREATE INDEX "DealerPromotionCampaign_createdByAdminId_idx" ON "DealerPromotionCampaign"("createdByAdminId");

ALTER TABLE "Subscription" ADD COLUMN "promotionCampaignId" TEXT;
CREATE INDEX "Subscription_promotionCampaignId_idx" ON "Subscription"("promotionCampaignId");

CREATE TABLE "DealerOnboardingInvite" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "dealerId" TEXT NOT NULL,
  "targetAuthUserId" TEXT NOT NULL,
  "originalEmail" TEXT NOT NULL,
  "recipientEmailNorm" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "status" "DealerOnboardingInviteStatus" NOT NULL,
  "campaignStartsAt" TIMESTAMP(3) NOT NULL,
  "campaignEndsAt" TIMESTAMP(3) NOT NULL,
  "campaignTier" "DealerTier" NOT NULL,
  "sentAt" TIMESTAMP(3),
  "claimedAt" TIMESTAMP(3),
  "finalizingAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "sendAttemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "resendMessageId" TEXT,
  "createdByAdminId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DealerOnboardingInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DealerOnboardingInvite_tokenHash_key" ON "DealerOnboardingInvite"("tokenHash");
CREATE INDEX "DealerOnboardingInvite_userId_status_idx" ON "DealerOnboardingInvite"("userId", "status");
CREATE INDEX "DealerOnboardingInvite_dealerId_status_idx" ON "DealerOnboardingInvite"("dealerId", "status");
CREATE INDEX "DealerOnboardingInvite_recipientEmailNorm_idx" ON "DealerOnboardingInvite"("recipientEmailNorm");
CREATE INDEX "DealerOnboardingInvite_status_expiresAt_idx" ON "DealerOnboardingInvite"("status", "expiresAt");
CREATE INDEX "DealerOnboardingInvite_createdByAdminId_idx" ON "DealerOnboardingInvite"("createdByAdminId");

CREATE UNIQUE INDEX "DealerOnboardingInvite_live_dealerId_key"
ON "DealerOnboardingInvite"("dealerId")
WHERE "status" IN ('SEND_FAILED', 'SENT', 'CLAIMING', 'FINALIZING_AUTH');

CREATE UNIQUE INDEX "DealerOnboardingInvite_live_recipient_key"
ON "DealerOnboardingInvite"("recipientEmailNorm")
WHERE "status" IN ('SEND_FAILED', 'SENT', 'CLAIMING', 'FINALIZING_AUTH');

CREATE TABLE "DealerOnboardingInviteEvent" (
  "id" TEXT NOT NULL,
  "inviteId" TEXT NOT NULL,
  "fromStatus" "DealerOnboardingInviteStatus",
  "toStatus" "DealerOnboardingInviteStatus" NOT NULL,
  "actorUserId" TEXT,
  "source" TEXT NOT NULL,
  "policySnapshot" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DealerOnboardingInviteEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DealerOnboardingInviteEvent_inviteId_createdAt_idx"
ON "DealerOnboardingInviteEvent"("inviteId", "createdAt");

ALTER TABLE "DealerPromotionCampaign"
ADD CONSTRAINT "DealerPromotionCampaign_createdByAdminId_fkey"
FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Subscription"
ADD CONSTRAINT "Subscription_promotionCampaignId_fkey"
FOREIGN KEY ("promotionCampaignId") REFERENCES "DealerPromotionCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DealerOnboardingInvite"
ADD CONSTRAINT "DealerOnboardingInvite_campaignId_fkey"
FOREIGN KEY ("campaignId") REFERENCES "DealerPromotionCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DealerOnboardingInvite"
ADD CONSTRAINT "DealerOnboardingInvite_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DealerOnboardingInvite"
ADD CONSTRAINT "DealerOnboardingInvite_dealerId_fkey"
FOREIGN KEY ("dealerId") REFERENCES "DealerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DealerOnboardingInvite"
ADD CONSTRAINT "DealerOnboardingInvite_createdByAdminId_fkey"
FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DealerOnboardingInviteEvent"
ADD CONSTRAINT "DealerOnboardingInviteEvent_inviteId_fkey"
FOREIGN KEY ("inviteId") REFERENCES "DealerOnboardingInvite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DealerOnboardingInviteEvent"
ADD CONSTRAINT "DealerOnboardingInviteEvent_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."DealerPromotionCampaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."DealerOnboardingInvite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."DealerOnboardingInviteEvent" ENABLE ROW LEVEL SECURITY;
