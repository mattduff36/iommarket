-- Durable checkout attempts and provenance-aware reconciliation.
-- This migration is additive; it deliberately does not mutate existing payments.

ALTER TABLE "SubscriptionCharge"
  ADD COLUMN "refundedAt" TIMESTAMP(3),
  ADD COLUMN "refundEventId" TEXT;

ALTER TABLE "MonitoringEvent"
  ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "MonitoringEvent_dedupeKey_key"
  ON "MonitoringEvent"("dedupeKey");

CREATE TYPE "PaymentCheckoutKind" AS ENUM (
  'LISTING_PAYMENT',
  'LISTING_AND_FEATURED',
  'FEATURED_UPGRADE',
  'DEALER_SUBSCRIPTION'
);

CREATE TYPE "PaymentCheckoutAttemptStatus" AS ENUM (
  'OPEN',
  'RETURNED',
  'CONFIRMED',
  'FAILED',
  'REVIEW',
  'EXPIRED'
);

CREATE TYPE "PaymentReconciliationEvidenceType" AS ENUM (
  'VERIFIED_WEBHOOK',
  'ADMIN_PROVIDER_ATTESTATION'
);

CREATE TYPE "ProviderPaymentClaimSource" AS ENUM (
  'VERIFIED_WEBHOOK',
  'ADMIN_PROVIDER_ATTESTATION',
  'LEGACY_RECORDED'
);

CREATE TABLE "PaymentCheckoutAttempt" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "listingId" TEXT,
  "dealerId" TEXT,
  "paymentId" TEXT,
  "kind" "PaymentCheckoutKind" NOT NULL,
  "status" "PaymentCheckoutAttemptStatus" NOT NULL DEFAULT 'OPEN',
  "merchantReference" TEXT NOT NULL,
  "productCode" TEXT NOT NULL,
  "tier" "DealerTier",
  "amountPence" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'gbp',
  "environment" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "returnedAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "alertedAt" TIMESTAMP(3),
  "alertLeaseUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PaymentCheckoutAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentCheckoutAttempt_amountPence_check" CHECK ("amountPence" > 0),
  CONSTRAINT "PaymentCheckoutAttempt_currency_check" CHECK ("currency" = lower("currency") AND length("currency") = 3),
  CONSTRAINT "PaymentCheckoutAttempt_target_check" CHECK (
    (
      "kind" = 'DEALER_SUBSCRIPTION'
      AND "dealerId" IS NOT NULL
      AND "listingId" IS NULL
      AND "paymentId" IS NULL
      AND "tier" IS NOT NULL
    )
    OR
    (
      "kind" <> 'DEALER_SUBSCRIPTION'
      AND "listingId" IS NOT NULL
      AND "dealerId" IS NULL
      AND "paymentId" IS NOT NULL
      AND "tier" IS NULL
    )
  )
);

CREATE TABLE "PaymentCheckoutObservation" (
  "id" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "providerPaymentId" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaymentCheckoutObservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderPaymentClaim" (
  "id" TEXT NOT NULL,
  "paymentProvider" "PaymentProvider" NOT NULL,
  "providerPaymentId" TEXT NOT NULL,
  "attemptId" TEXT,
  "paymentId" TEXT,
  "subscriptionChargeId" TEXT,
  "source" "ProviderPaymentClaimSource" NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProviderPaymentClaim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProviderPaymentClaim_owner_check" CHECK (
    num_nonnulls("paymentId", "subscriptionChargeId") = 1
  )
);

CREATE TABLE "PaymentReconciliation" (
  "id" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "evidenceType" "PaymentReconciliationEvidenceType" NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "providerPaymentId" TEXT NOT NULL,
  "providerEventAt" TIMESTAMP(3) NOT NULL,
  "adminId" TEXT,
  "notes" TEXT,
  "evidenceSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaymentReconciliation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentReconciliation_provenance_check" CHECK (
    ("evidenceType" = 'VERIFIED_WEBHOOK' AND "adminId" IS NULL)
    OR
    ("evidenceType" = 'ADMIN_PROVIDER_ATTESTATION' AND "adminId" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "PaymentCheckoutAttempt_paymentId_key"
  ON "PaymentCheckoutAttempt"("paymentId");
CREATE UNIQUE INDEX "PaymentCheckoutAttempt_merchantReference_key"
  ON "PaymentCheckoutAttempt"("merchantReference");
CREATE INDEX "PaymentCheckoutAttempt_status_createdAt_idx"
  ON "PaymentCheckoutAttempt"("status", "createdAt");
CREATE INDEX "PaymentCheckoutAttempt_userId_status_idx"
  ON "PaymentCheckoutAttempt"("userId", "status");
CREATE INDEX "PaymentCheckoutAttempt_listingId_status_idx"
  ON "PaymentCheckoutAttempt"("listingId", "status");
CREATE INDEX "PaymentCheckoutAttempt_dealerId_status_idx"
  ON "PaymentCheckoutAttempt"("dealerId", "status");

CREATE UNIQUE INDEX "PaymentCheckoutObservation_attemptId_providerPaymentId_key"
  ON "PaymentCheckoutObservation"("attemptId", "providerPaymentId");
CREATE INDEX "PaymentCheckoutObservation_providerPaymentId_idx"
  ON "PaymentCheckoutObservation"("providerPaymentId");

CREATE UNIQUE INDEX "ProviderPaymentClaim_paymentId_key"
  ON "ProviderPaymentClaim"("paymentId");
CREATE UNIQUE INDEX "ProviderPaymentClaim_subscriptionChargeId_key"
  ON "ProviderPaymentClaim"("subscriptionChargeId");
CREATE UNIQUE INDEX "ProviderPaymentClaim_paymentProvider_providerPaymentId_key"
  ON "ProviderPaymentClaim"("paymentProvider", "providerPaymentId");
CREATE INDEX "ProviderPaymentClaim_attemptId_idx"
  ON "ProviderPaymentClaim"("attemptId");

CREATE UNIQUE INDEX "PaymentReconciliation_attemptId_evidenceType_evidenceId_key"
  ON "PaymentReconciliation"("attemptId", "evidenceType", "evidenceId");
CREATE INDEX "PaymentReconciliation_providerPaymentId_idx"
  ON "PaymentReconciliation"("providerPaymentId");
CREATE INDEX "PaymentReconciliation_createdAt_idx"
  ON "PaymentReconciliation"("createdAt");

ALTER TABLE "PaymentCheckoutAttempt"
  ADD CONSTRAINT "PaymentCheckoutAttempt_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentCheckoutAttempt"
  ADD CONSTRAINT "PaymentCheckoutAttempt_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentCheckoutAttempt"
  ADD CONSTRAINT "PaymentCheckoutAttempt_dealerId_fkey"
  FOREIGN KEY ("dealerId") REFERENCES "DealerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentCheckoutAttempt"
  ADD CONSTRAINT "PaymentCheckoutAttempt_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentCheckoutObservation"
  ADD CONSTRAINT "PaymentCheckoutObservation_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "PaymentCheckoutAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProviderPaymentClaim"
  ADD CONSTRAINT "ProviderPaymentClaim_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "PaymentCheckoutAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProviderPaymentClaim"
  ADD CONSTRAINT "ProviderPaymentClaim_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderPaymentClaim"
  ADD CONSTRAINT "ProviderPaymentClaim_subscriptionChargeId_fkey"
  FOREIGN KEY ("subscriptionChargeId") REFERENCES "SubscriptionCharge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentReconciliation"
  ADD CONSTRAINT "PaymentReconciliation_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "PaymentCheckoutAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Put legacy open Ripple payments into the review queue without inventing a
-- provider payment ID or treating them as revenue.
INSERT INTO "PaymentCheckoutAttempt" (
  "id",
  "userId",
  "listingId",
  "paymentId",
  "kind",
  "status",
  "merchantReference",
  "productCode",
  "amountPence",
  "currency",
  "environment",
  "expiresAt",
  "createdAt",
  "updatedAt"
)
SELECT
  'attempt_' || payment."id",
  listing."userId",
  payment."listingId",
  payment."id",
  CASE
    WHEN payment."type" = 'FEATURED' THEN 'FEATURED_UPGRADE'::"PaymentCheckoutKind"
    WHEN payment."includesFeatured" THEN 'LISTING_AND_FEATURED'::"PaymentCheckoutKind"
    ELSE 'LISTING_PAYMENT'::"PaymentCheckoutKind"
  END,
  'REVIEW'::"PaymentCheckoutAttemptStatus",
  payment."providerReference",
  CASE
    WHEN payment."type" = 'FEATURED' THEN '1BB714D5DBC446B6'
    WHEN payment."includesFeatured" THEN '9AFE8E93CD3145D3'
    ELSE '74A7510E33E94821'
  END,
  payment."amount",
  lower(payment."currency"),
  'legacy',
  payment."createdAt" + INTERVAL '30 minutes',
  payment."createdAt",
  CURRENT_TIMESTAMP
FROM "Payment" payment
JOIN "Listing" listing ON listing."id" = payment."listingId"
WHERE payment."paymentProvider" = 'RIPPLE'
  AND payment."status" = 'PENDING'
  AND payment."providerPaymentId" IS NULL
  AND payment."providerReference" IS NOT NULL
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Payment" payment
    JOIN "SubscriptionCharge" charge
      ON charge."paymentReference" = payment."providerPaymentId"
    JOIN "Subscription" subscription
      ON subscription."id" = charge."subscriptionId"
    WHERE payment."paymentProvider" = subscription."paymentProvider"
      AND payment."providerPaymentId" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Existing Ripple provider reference is owned by both a payment and subscription charge';
  END IF;
END $$;

INSERT INTO "ProviderPaymentClaim" (
  "id",
  "paymentProvider",
  "providerPaymentId",
  "attemptId",
  "paymentId",
  "source",
  "claimedAt"
)
SELECT
  'claim_payment_' || payment."id",
  payment."paymentProvider",
  payment."providerPaymentId",
  attempt."id",
  payment."id",
  'LEGACY_RECORDED'::"ProviderPaymentClaimSource",
  COALESCE(payment."lastProviderEventAt", payment."updatedAt")
FROM "Payment" payment
LEFT JOIN "PaymentCheckoutAttempt" attempt
  ON attempt."paymentId" = payment."id"
WHERE payment."providerPaymentId" IS NOT NULL;

INSERT INTO "ProviderPaymentClaim" (
  "id",
  "paymentProvider",
  "providerPaymentId",
  "subscriptionChargeId",
  "source",
  "claimedAt"
)
SELECT
  'claim_charge_' || charge."id",
  subscription."paymentProvider",
  charge."paymentReference",
  charge."id",
  'LEGACY_RECORDED'::"ProviderPaymentClaimSource",
  charge."eventTimestamp"
FROM "SubscriptionCharge" charge
JOIN "Subscription" subscription
  ON subscription."id" = charge."subscriptionId";

ALTER TABLE "PaymentCheckoutAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentCheckoutObservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProviderPaymentClaim" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentReconciliation" ENABLE ROW LEVEL SECURITY;
