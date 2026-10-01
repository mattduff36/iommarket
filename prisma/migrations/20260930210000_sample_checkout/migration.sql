CREATE TABLE "SampleCheckout" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "amountPence" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'gbp',
  "tier" "DealerTier",
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "returnUrl" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SampleCheckout_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SampleCheckout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SampleCheckout_kind_check" CHECK ("kind" IN ('listing_payment', 'featured_upgrade', 'dealer_subscription')),
  CONSTRAINT "SampleCheckout_status_check" CHECK ("status" IN ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  CONSTRAINT "SampleCheckout_amount_check" CHECK ("amountPence" > 0),
  CONSTRAINT "SampleCheckout_attempt_check" CHECK ("attemptCount" BETWEEN 0 AND 3)
);
CREATE INDEX "SampleCheckout_userId_targetId_kind_createdAt_idx" ON "SampleCheckout"("userId", "targetId", "kind", "createdAt");
ALTER TABLE "SampleCheckout" ENABLE ROW LEVEL SECURITY;
