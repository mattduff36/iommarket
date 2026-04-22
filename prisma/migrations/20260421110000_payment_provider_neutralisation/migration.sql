-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'RIPPLE', 'DEV');

-- AlterTable
ALTER TABLE "Payment"
ADD COLUMN "paymentProvider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
ADD COLUMN "providerPaymentId" TEXT,
ADD COLUMN "providerReference" TEXT;

ALTER TABLE "Payment"
ALTER COLUMN "stripePaymentId" DROP NOT NULL;

UPDATE "Payment"
SET
  "providerPaymentId" = COALESCE("providerPaymentId", "stripePaymentId"),
  "providerReference" = COALESCE("providerReference", "idempotencyKey"),
  "paymentProvider" = COALESCE("paymentProvider", 'STRIPE');

CREATE UNIQUE INDEX IF NOT EXISTS "Payment_providerPaymentId_key"
ON "Payment"("providerPaymentId");

CREATE UNIQUE INDEX IF NOT EXISTS "Payment_providerReference_key"
ON "Payment"("providerReference");

CREATE INDEX IF NOT EXISTS "Payment_paymentProvider_idx"
ON "Payment"("paymentProvider");

CREATE INDEX IF NOT EXISTS "Payment_providerPaymentId_idx"
ON "Payment"("providerPaymentId");

CREATE INDEX IF NOT EXISTS "Payment_providerReference_idx"
ON "Payment"("providerReference");

-- AlterTable
ALTER TABLE "Subscription"
ADD COLUMN "paymentProvider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
ADD COLUMN "providerSubscriptionId" TEXT,
ADD COLUMN "providerPlanId" TEXT;

ALTER TABLE "Subscription"
ALTER COLUMN "stripeSubscriptionId" DROP NOT NULL,
ALTER COLUMN "stripePriceId" DROP NOT NULL;

UPDATE "Subscription"
SET
  "providerSubscriptionId" = COALESCE("providerSubscriptionId", "stripeSubscriptionId"),
  "providerPlanId" = COALESCE("providerPlanId", "stripePriceId"),
  "paymentProvider" = COALESCE("paymentProvider", 'STRIPE');

CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_providerSubscriptionId_key"
ON "Subscription"("providerSubscriptionId");

CREATE INDEX IF NOT EXISTS "Subscription_paymentProvider_idx"
ON "Subscription"("paymentProvider");

CREATE INDEX IF NOT EXISTS "Subscription_providerSubscriptionId_idx"
ON "Subscription"("providerSubscriptionId");
