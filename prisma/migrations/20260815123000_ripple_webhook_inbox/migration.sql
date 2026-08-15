-- CreateEnum
CREATE TYPE "SubscriptionProviderLifecycle" AS ENUM ('NONE', 'CREATED', 'ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WebhookInboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'QUARANTINED');

-- AlterTable
ALTER TABLE "Payment"
ADD COLUMN "lastProviderEventAt" TIMESTAMP(3),
ADD COLUMN "lastProviderEventType" TEXT,
ADD COLUMN "lastProviderEventFingerprint" TEXT;

-- AlterTable
ALTER TABLE "Subscription"
ADD COLUMN "providerLifecycle" "SubscriptionProviderLifecycle" NOT NULL DEFAULT 'NONE',
ADD COLUMN "customerEmailNorm" TEXT,
ADD COLUMN "lastProviderEventAt" TIMESTAMP(3),
ADD COLUMN "lastProviderEventType" TEXT,
ADD COLUMN "lastProviderEventFingerprint" TEXT;

-- CreateTable
CREATE TABLE "SubscriptionCharge" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "paymentReference" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'gbp',
    "eventTimestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhookInbox" (
    "id" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventTimestamp" TIMESTAMP(3) NOT NULL,
    "clientId" TEXT NOT NULL,
    "paymentReference" TEXT,
    "merchantReference" TEXT,
    "linkCode" TEXT,
    "packageName" TEXT,
    "customerEmailNorm" TEXT,
    "amountPence" INTEGER,
    "currency" TEXT,
    "recurring" BOOLEAN,
    "linkType" TEXT,
    "minimizedPayload" JSONB NOT NULL,
    "status" "WebhookInboxStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentWebhookInbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionCharge_paymentReference_key" ON "SubscriptionCharge"("paymentReference");

-- CreateIndex
CREATE INDEX "SubscriptionCharge_subscriptionId_idx" ON "SubscriptionCharge"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookInbox_bodyHash_key" ON "PaymentWebhookInbox"("bodyHash");

-- CreateIndex
CREATE INDEX "PaymentWebhookInbox_status_createdAt_idx" ON "PaymentWebhookInbox"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentWebhookInbox_eventType_eventTimestamp_idx" ON "PaymentWebhookInbox"("eventType", "eventTimestamp");

-- CreateIndex
CREATE INDEX "PaymentWebhookInbox_paymentReference_idx" ON "PaymentWebhookInbox"("paymentReference");

-- CreateIndex
CREATE INDEX "Subscription_customerEmailNorm_providerPlanId_idx" ON "Subscription"("customerEmailNorm", "providerPlanId");

-- AddForeignKey
ALTER TABLE "SubscriptionCharge" ADD CONSTRAINT "SubscriptionCharge_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
