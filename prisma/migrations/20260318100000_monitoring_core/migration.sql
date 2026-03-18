-- CreateEnum
CREATE TYPE "MonitoringIssueStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'MUTED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "MonitoringSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "MonitoringSource" AS ENUM ('SERVER', 'CLIENT', 'WEBHOOK', 'BUSINESS');

-- CreateEnum
CREATE TYPE "MonitoringAlertChannel" AS ENUM ('EMAIL', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "MonitoringAlertStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "MonitoringIssue" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "MonitoringIssueStatus" NOT NULL DEFAULT 'OPEN',
    "severity" "MonitoringSeverity" NOT NULL DEFAULT 'MEDIUM',
    "source" "MonitoringSource" NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "sampleMessage" TEXT NOT NULL,
    "sampleRoute" TEXT,
    "sampleAction" TEXT,
    "sampleComponent" TEXT,
    "mutedUntil" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "assigneeAdminId" TEXT,
    "lastAlertedAt" TIMESTAMP(3),
    "lastGeneratedPrompt" TEXT,
    "lastPromptGeneratedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoringIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringEvent" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "source" "MonitoringSource" NOT NULL,
    "severity" "MonitoringSeverity" NOT NULL,
    "environment" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "route" TEXT,
    "action" TEXT,
    "component" TEXT,
    "requestMethod" TEXT,
    "requestPath" TEXT,
    "requestId" TEXT,
    "userId" TEXT,
    "userEmail" TEXT,
    "ipHash" TEXT,
    "tags" JSONB,
    "extra" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringAlertDelivery" (
    "id" TEXT NOT NULL,
    "issueId" TEXT,
    "eventId" TEXT,
    "channel" "MonitoringAlertChannel" NOT NULL,
    "target" TEXT NOT NULL,
    "status" "MonitoringAlertStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoringAlertDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringIssue_fingerprint_key" ON "MonitoringIssue"("fingerprint");

-- CreateIndex
CREATE INDEX "MonitoringIssue_status_severity_lastSeenAt_idx" ON "MonitoringIssue"("status", "severity", "lastSeenAt");

-- CreateIndex
CREATE INDEX "MonitoringIssue_source_lastSeenAt_idx" ON "MonitoringIssue"("source", "lastSeenAt");

-- CreateIndex
CREATE INDEX "MonitoringIssue_createdAt_idx" ON "MonitoringIssue"("createdAt");

-- CreateIndex
CREATE INDEX "MonitoringEvent_issueId_occurredAt_idx" ON "MonitoringEvent"("issueId", "occurredAt");

-- CreateIndex
CREATE INDEX "MonitoringEvent_source_severity_occurredAt_idx" ON "MonitoringEvent"("source", "severity", "occurredAt");

-- CreateIndex
CREATE INDEX "MonitoringEvent_requestPath_occurredAt_idx" ON "MonitoringEvent"("requestPath", "occurredAt");

-- CreateIndex
CREATE INDEX "MonitoringAlertDelivery_status_createdAt_idx" ON "MonitoringAlertDelivery"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MonitoringAlertDelivery_channel_status_createdAt_idx" ON "MonitoringAlertDelivery"("channel", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MonitoringAlertDelivery_issueId_createdAt_idx" ON "MonitoringAlertDelivery"("issueId", "createdAt");

-- CreateIndex
CREATE INDEX "MonitoringAlertDelivery_eventId_createdAt_idx" ON "MonitoringAlertDelivery"("eventId", "createdAt");

-- AddForeignKey
ALTER TABLE "MonitoringEvent" ADD CONSTRAINT "MonitoringEvent_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "MonitoringIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringAlertDelivery" ADD CONSTRAINT "MonitoringAlertDelivery_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "MonitoringIssue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringAlertDelivery" ADD CONSTRAINT "MonitoringAlertDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "MonitoringEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
