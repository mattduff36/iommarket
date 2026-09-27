-- Prepared only. Do not apply as part of finalise or this implementation task.
-- Adds durable Cursor event, allowance and iTrader policy rows.
-- Existing invoices, settlements and gbp-markup-v1 entries are left in place.

CREATE TABLE IF NOT EXISTS "CostUsageEvent" (
  "id" TEXT NOT NULL,
  "providerAccountRef" TEXT NOT NULL,
  "projectId" TEXT,
  "attributionStatus" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "fundingStatus" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "nominalUsd" DECIMAL(20,8),
  "providerChargeUsd" DECIMAL(20,8),
  "clientUsd" DECIMAL(20,8),
  "policyVersion" TEXT,
  "sourceQuality" TEXT NOT NULL,
  "rawKind" TEXT,
  "checksum" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CostUsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CostUsageEvent_providerAccountRef_occurredAt_idx"
  ON "CostUsageEvent"("providerAccountRef", "occurredAt");

CREATE INDEX IF NOT EXISTS "CostUsageEvent_projectId_occurredAt_idx"
  ON "CostUsageEvent"("projectId", "occurredAt");

CREATE TABLE IF NOT EXISTS "CostIngestBatch" (
  "id" TEXT NOT NULL,
  "providerAccountRef" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "queryFrom" TIMESTAMPTZ(3) NOT NULL,
  "queryTo" TIMESTAMPTZ(3) NOT NULL,
  "classifiedCount" INTEGER NOT NULL DEFAULT 0,
  "unresolvedCount" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  CONSTRAINT "CostIngestBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CostIngestBatch_status_startedAt_idx"
  ON "CostIngestBatch"("status", "startedAt");

CREATE TABLE IF NOT EXISTS "CostAllowanceObservation" (
  "id" TEXT NOT NULL,
  "providerAccountRef" TEXT NOT NULL,
  "observedAt" TIMESTAMPTZ(3) NOT NULL,
  "cycleStart" TIMESTAMPTZ(3),
  "cycleEnd" TIMESTAMPTZ(3),
  "poolLabel" TEXT,
  "reportedAllowanceUsd" DECIMAL(20,8),
  "remainingUsd" DECIMAL(20,8),
  "accountNominalUsd" DECIMAL(20,8),
  "accountOnDemandUsd" DECIMAL(20,8),
  "quality" TEXT NOT NULL,
  "expectationUsd" DECIMAL(20,8) NOT NULL,
  "expectationCrossed" BOOLEAN NOT NULL,
  "confirmedOnDemand" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CostAllowanceObservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CostAllowanceObservation_providerAccountRef_observedAt_idx"
  ON "CostAllowanceObservation"("providerAccountRef", "observedAt");

CREATE TABLE IF NOT EXISTS "CostClientPolicy" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
  "includedNumerator" INTEGER NOT NULL,
  "includedDenominator" INTEGER NOT NULL,
  "onDemandNumerator" INTEGER NOT NULL,
  "onDemandDenominator" INTEGER NOT NULL,
  "exemptFromInfraMarkup" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CostClientPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CostClientPolicy_projectId_version_key"
  ON "CostClientPolicy"("projectId", "version");

INSERT INTO "CostClientPolicy" (
  "id",
  "projectId",
  "version",
  "effectiveFrom",
  "includedNumerator",
  "includedDenominator",
  "onDemandNumerator",
  "onDemandDenominator",
  "exemptFromInfraMarkup"
) VALUES (
  'itrader-cursor-60-110-v1',
  'itrader',
  'itrader-cursor-60-110-v1',
  TIMESTAMPTZ '2026-09-26T00:00:00.000Z',
  60,
  100,
  110,
  100,
  TRUE
) ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "public"."CostUsageEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CostIngestBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CostAllowanceObservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CostClientPolicy" ENABLE ROW LEVEL SECURITY;
