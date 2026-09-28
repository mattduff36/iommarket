ALTER TYPE "PolicyAcceptanceSource" ADD VALUE IF NOT EXISTS 'ADMIN_UPGRADE';

CREATE TYPE "DealerUpgradeOfferStatus" AS ENUM (
  'PENDING',
  'ACCEPTED',
  'CANCELLED'
);

CREATE TABLE "DealerUpgradeOffer" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "durationDays" INTEGER NOT NULL,
  "status" "DealerUpgradeOfferStatus" NOT NULL DEFAULT 'PENDING',
  "createdByAdminId" TEXT NOT NULL,
  "emailSentAt" TIMESTAMP(3),
  "emailMessageId" TEXT,
  "emailLastError" TEXT,
  "emailClaimedAt" TIMESTAMP(3),
  "emailClaimToken" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "cancelledByAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DealerUpgradeOffer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DealerUpgradeOffer_durationDays_check"
    CHECK ("durationDays" BETWEEN 1 AND 3650),
  CONSTRAINT "DealerUpgradeOffer_email_claim_check" CHECK (
    ("emailClaimedAt" IS NULL AND "emailClaimToken" IS NULL)
    OR ("emailClaimedAt" IS NOT NULL AND "emailClaimToken" IS NOT NULL)
  ),
  CONSTRAINT "DealerUpgradeOffer_terminal_state_check" CHECK (
    (
      "status" = 'PENDING'
      AND "acceptedAt" IS NULL
      AND "cancelledAt" IS NULL
      AND "cancelledByAdminId" IS NULL
    )
    OR (
      "status" = 'ACCEPTED'
      AND "acceptedAt" IS NOT NULL
      AND "cancelledAt" IS NULL
      AND "cancelledByAdminId" IS NULL
      AND "emailClaimedAt" IS NULL
      AND "emailClaimToken" IS NULL
    )
    OR (
      "status" = 'CANCELLED'
      AND "acceptedAt" IS NULL
      AND "cancelledAt" IS NOT NULL
      AND "cancelledByAdminId" IS NOT NULL
      AND "emailClaimedAt" IS NULL
      AND "emailClaimToken" IS NULL
    )
  )
);

CREATE INDEX "DealerUpgradeOffer_userId_status_idx"
ON "DealerUpgradeOffer"("userId", "status");

CREATE INDEX "DealerUpgradeOffer_createdByAdminId_idx"
ON "DealerUpgradeOffer"("createdByAdminId");

CREATE INDEX "DealerUpgradeOffer_cancelledByAdminId_idx"
ON "DealerUpgradeOffer"("cancelledByAdminId");

CREATE UNIQUE INDEX "DealerUpgradeOffer_id_userId_key"
ON "DealerUpgradeOffer"("id", "userId");

CREATE UNIQUE INDEX "DealerUpgradeOffer_one_pending_per_user_key"
ON "DealerUpgradeOffer"("userId")
WHERE "status" = 'PENDING';

ALTER TABLE "DealerUpgradeOffer"
ADD CONSTRAINT "DealerUpgradeOffer_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DealerUpgradeOffer"
ADD CONSTRAINT "DealerUpgradeOffer_createdByAdminId_fkey"
FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DealerUpgradeOffer"
ADD CONSTRAINT "DealerUpgradeOffer_cancelledByAdminId_fkey"
FOREIGN KEY ("cancelledByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "DealerUpgradeAcceptance" (
  "id" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "source" "PolicyAcceptanceSource" NOT NULL DEFAULT 'ADMIN_UPGRADE',
  "bundleVersion" TEXT NOT NULL,
  "policyVersions" JSONB NOT NULL,
  "contentHashes" JSONB NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DealerUpgradeAcceptance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DealerUpgradeAcceptance_source_check"
    CHECK ("source" = 'ADMIN_UPGRADE')
);

CREATE UNIQUE INDEX "DealerUpgradeAcceptance_offerId_key"
ON "DealerUpgradeAcceptance"("offerId");

CREATE UNIQUE INDEX "DealerUpgradeAcceptance_offerId_userId_key"
ON "DealerUpgradeAcceptance"("offerId", "userId");

CREATE INDEX "DealerUpgradeAcceptance_userId_acceptedAt_idx"
ON "DealerUpgradeAcceptance"("userId", "acceptedAt");

ALTER TABLE "DealerUpgradeAcceptance"
ADD CONSTRAINT "DealerUpgradeAcceptance_offerId_userId_fkey"
FOREIGN KEY ("offerId", "userId") REFERENCES "DealerUpgradeOffer"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DealerUpgradeAcceptance"
ADD CONSTRAINT "DealerUpgradeAcceptance_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "protect_dealer_upgrade_terminal_state"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'Terminal dealer upgrade offers are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "DealerUpgradeOffer_terminal_state_immutable"
BEFORE UPDATE OR DELETE ON "DealerUpgradeOffer"
FOR EACH ROW
WHEN (OLD."status" <> 'PENDING')
EXECUTE FUNCTION "protect_dealer_upgrade_terminal_state"();

CREATE FUNCTION "protect_dealer_upgrade_acceptance_receipt"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Dealer upgrade acceptance receipts are immutable';
END;
$$;

CREATE TRIGGER "DealerUpgradeAcceptance_immutable"
BEFORE UPDATE OR DELETE ON "DealerUpgradeAcceptance"
FOR EACH ROW
EXECUTE FUNCTION "protect_dealer_upgrade_acceptance_receipt"();

ALTER TABLE "public"."DealerUpgradeOffer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."DealerUpgradeAcceptance" ENABLE ROW LEVEL SECURITY;
