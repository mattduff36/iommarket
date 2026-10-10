-- Additive dealer website stock sync. Does not change existing listing rows.
-- Apply this migration only through the normal release process. The worker
-- must be deployed before any queued job can scrape or apply.

CREATE TYPE "DealerStockSyncJobKind" AS ENUM ('SCRAPE', 'APPLY');
CREATE TYPE "DealerStockSyncJobStatus" AS ENUM ('QUEUED', 'LEASED', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "DealerStockSyncReportStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'APPLIED', 'REJECTED', 'SUPERSEDED', 'FAILED');

CREATE TABLE "DealerStockSourceBinding" (
  "id" TEXT NOT NULL,
  "dealerId" TEXT NOT NULL,
  "registryKey" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "verifiedAt" TIMESTAMP(3),
  "verifiedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DealerStockSourceBinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DealerStockSourceBinding_dealerId_key" ON "DealerStockSourceBinding"("dealerId");
CREATE UNIQUE INDEX "DealerStockSourceBinding_registryKey_key" ON "DealerStockSourceBinding"("registryKey");
CREATE INDEX "DealerStockSourceBinding_enabled_idx" ON "DealerStockSourceBinding"("enabled");
CREATE INDEX "DealerStockSourceBinding_verifiedById_idx" ON "DealerStockSourceBinding"("verifiedById");

CREATE TABLE "DealerStockSourceIdentity" (
  "id" TEXT NOT NULL,
  "bindingId" TEXT NOT NULL,
  "dealerId" TEXT NOT NULL,
  "sourceIdentityKey" TEXT NOT NULL,
  "listingId" TEXT,
  "absenceCount" INTEGER NOT NULL DEFAULT 0,
  "lastAbsenceRunId" TEXT,
  "lastSeenRunId" TEXT,
  "baselinePricePence" INTEGER,
  "baselineMileage" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DealerStockSourceIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DealerStockSourceIdentity_listingId_key" ON "DealerStockSourceIdentity"("listingId");
CREATE UNIQUE INDEX "DealerStockSourceIdentity_dealerId_sourceIdentityKey_key" ON "DealerStockSourceIdentity"("dealerId", "sourceIdentityKey");
CREATE INDEX "DealerStockSourceIdentity_bindingId_idx" ON "DealerStockSourceIdentity"("bindingId");
CREATE INDEX "DealerStockSourceIdentity_lastSeenRunId_idx" ON "DealerStockSourceIdentity"("lastSeenRunId");

CREATE TABLE "DealerStockSyncReport" (
  "id" TEXT NOT NULL,
  "bindingId" TEXT NOT NULL,
  "dealerId" TEXT NOT NULL,
  "scrapeRunId" TEXT NOT NULL,
  "status" "DealerStockSyncReportStatus" NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "plan" JSONB NOT NULL,
  "inventoryCount" INTEGER NOT NULL,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "appliedAt" TIMESTAMP(3),
  "supersededAt" TIMESTAMP(3),
  CONSTRAINT "DealerStockSyncReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DealerStockSyncReport_scrapeRunId_key" ON "DealerStockSyncReport"("scrapeRunId");
CREATE INDEX "DealerStockSyncReport_dealerId_status_createdAt_idx" ON "DealerStockSyncReport"("dealerId", "status", "createdAt");
CREATE INDEX "DealerStockSyncReport_bindingId_status_idx" ON "DealerStockSyncReport"("bindingId", "status");
CREATE INDEX "DealerStockSyncReport_approvedById_idx" ON "DealerStockSyncReport"("approvedById");

CREATE TABLE "DealerStockSyncJob" (
  "id" TEXT NOT NULL,
  "kind" "DealerStockSyncJobKind" NOT NULL,
  "status" "DealerStockSyncJobStatus" NOT NULL DEFAULT 'QUEUED',
  "bindingId" TEXT NOT NULL,
  "dealerId" TEXT NOT NULL,
  "reportId" TEXT,
  "weeklyKey" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "payload" JSONB NOT NULL,
  "error" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "DealerStockSyncJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DealerStockSyncJob_idempotencyKey_key" ON "DealerStockSyncJob"("idempotencyKey");
CREATE UNIQUE INDEX "DealerStockSyncJob_bindingId_weeklyKey_key" ON "DealerStockSyncJob"("bindingId", "weeklyKey");
CREATE INDEX "DealerStockSyncJob_status_kind_createdAt_idx" ON "DealerStockSyncJob"("status", "kind", "createdAt");
CREATE INDEX "DealerStockSyncJob_bindingId_status_idx" ON "DealerStockSyncJob"("bindingId", "status");
CREATE INDEX "DealerStockSyncJob_dealerId_idx" ON "DealerStockSyncJob"("dealerId");
CREATE INDEX "DealerStockSyncJob_createdById_idx" ON "DealerStockSyncJob"("createdById");
CREATE INDEX "DealerStockSyncJob_reportId_idx" ON "DealerStockSyncJob"("reportId");

CREATE TABLE "DealerStockSyncAudit" (
  "id" TEXT NOT NULL,
  "reportId" TEXT,
  "jobId" TEXT,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DealerStockSyncAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DealerStockSyncAudit_reportId_idx" ON "DealerStockSyncAudit"("reportId");
CREATE INDEX "DealerStockSyncAudit_jobId_idx" ON "DealerStockSyncAudit"("jobId");
CREATE INDEX "DealerStockSyncAudit_actorId_idx" ON "DealerStockSyncAudit"("actorId");

ALTER TABLE "DealerStockSourceBinding"
ADD CONSTRAINT "DealerStockSourceBinding_dealerId_fkey"
FOREIGN KEY ("dealerId") REFERENCES "DealerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DealerStockSourceBinding"
ADD CONSTRAINT "DealerStockSourceBinding_verifiedById_fkey"
FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DealerStockSourceIdentity"
ADD CONSTRAINT "DealerStockSourceIdentity_bindingId_fkey"
FOREIGN KEY ("bindingId") REFERENCES "DealerStockSourceBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DealerStockSourceIdentity"
ADD CONSTRAINT "DealerStockSourceIdentity_listingId_fkey"
FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DealerStockSyncReport"
ADD CONSTRAINT "DealerStockSyncReport_bindingId_fkey"
FOREIGN KEY ("bindingId") REFERENCES "DealerStockSourceBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DealerStockSyncReport"
ADD CONSTRAINT "DealerStockSyncReport_approvedById_fkey"
FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DealerStockSyncJob"
ADD CONSTRAINT "DealerStockSyncJob_bindingId_fkey"
FOREIGN KEY ("bindingId") REFERENCES "DealerStockSourceBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DealerStockSyncJob"
ADD CONSTRAINT "DealerStockSyncJob_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DealerStockSyncJob"
ADD CONSTRAINT "DealerStockSyncJob_reportId_fkey"
FOREIGN KEY ("reportId") REFERENCES "DealerStockSyncReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DealerStockSyncAudit"
ADD CONSTRAINT "DealerStockSyncAudit_reportId_fkey"
FOREIGN KEY ("reportId") REFERENCES "DealerStockSyncReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DealerStockSyncAudit"
ADD CONSTRAINT "DealerStockSyncAudit_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "DealerStockSyncJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DealerStockSyncAudit"
ADD CONSTRAINT "DealerStockSyncAudit_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."DealerStockSourceBinding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."DealerStockSourceIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."DealerStockSyncJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."DealerStockSyncReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."DealerStockSyncAudit" ENABLE ROW LEVEL SECURITY;
