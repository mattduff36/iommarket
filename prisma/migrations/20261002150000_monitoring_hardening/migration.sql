-- Durable monitoring alerts, acknowledgement context, and pipeline health.

CREATE TYPE "MonitoringAlertKind" AS ENUM ('IMMEDIATE', 'DIGEST', 'CANARY');

ALTER TABLE "MonitoringIssue"
  ADD COLUMN "acknowledgedAt" TIMESTAMP(3),
  ADD COLUMN "acknowledgedSeverity" "MonitoringSeverity",
  ADD COLUMN "suppressedAlertCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "MonitoringAlertDelivery"
  ADD COLUMN "kind" "MonitoringAlertKind" NOT NULL DEFAULT 'IMMEDIATE',
  ADD COLUMN "payload" JSONB,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "claimedAt" TIMESTAMP(3),
  ADD COLUMN "claimExpiresAt" TIMESTAMP(3);

CREATE INDEX "MonitoringAlertDelivery_status_nextAttemptAt_idx"
  ON "MonitoringAlertDelivery"("status", "nextAttemptAt");

CREATE TABLE "MonitoringPipelineHealth" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "lastCaptureAt" TIMESTAMP(3),
  "lastCaptureFailureAt" TIMESTAMP(3),
  "lastCaptureFailure" TEXT,
  "consecutiveCaptureFailures" INTEGER NOT NULL DEFAULT 0,
  "lastAlertSuccessAt" TIMESTAMP(3),
  "lastAlertFailureAt" TIMESTAMP(3),
  "lastAlertFailure" TEXT,
  "consecutiveAlertFailures" INTEGER NOT NULL DEFAULT 0,
  "suppressedAlertCount" INTEGER NOT NULL DEFAULT 0,
  "lastDigestAt" TIMESTAMP(3),
  "lastCanaryAt" TIMESTAMP(3),
  "lastCanaryResult" TEXT,
  "lastRetentionAt" TIMESTAMP(3),
  "vercelFallbackStatus" TEXT,
  "vercelFallbackCheckedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MonitoringPipelineHealth_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."MonitoringPipelineHealth" ENABLE ROW LEVEL SECURITY;
