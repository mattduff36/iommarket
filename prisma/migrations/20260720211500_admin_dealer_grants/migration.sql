-- Distinguish paid subscriptions from administrator-granted dealer access.
-- Existing subscriptions remain PAYMENT records and are not backfilled as grants.
CREATE TYPE "SubscriptionSource" AS ENUM ('PAYMENT', 'ADMIN_GRANT');

ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'ADMIN';

ALTER TABLE "Subscription"
ADD COLUMN "source" "SubscriptionSource" NOT NULL DEFAULT 'PAYMENT',
ADD COLUMN "grantStartsAt" TIMESTAMP(3),
ADD COLUMN "grantEndsAt" TIMESTAMP(3),
ADD COLUMN "grantedByAdminId" TEXT,
ADD COLUMN "revokedAt" TIMESTAMP(3);

CREATE INDEX "Subscription_dealerId_source_status_grantEndsAt_idx"
ON "Subscription"("dealerId", "source", "status", "grantEndsAt");

-- At most one renewable, non-revoked administrator grant can exist per dealer.
-- Expiry is evaluated from grantEndsAt at read time, so no scheduled job is needed.
CREATE UNIQUE INDEX "Subscription_active_admin_grant_dealerId_key"
ON "Subscription"("dealerId")
WHERE "source" = 'ADMIN_GRANT' AND "status" = 'ACTIVE';
