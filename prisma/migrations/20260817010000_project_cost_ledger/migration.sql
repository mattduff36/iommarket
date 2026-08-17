-- Append-only project cost ledger, invoice requests, and private RLS.
-- Accounting rows are never rewritten; corrections use compensating entries.

DO $$ BEGIN
  CREATE TYPE "CostCategory" AS ENUM (
    'CURSOR',
    'VERCEL_HOSTING',
    'DATABASE',
    'SHARED_VERCEL',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CostEntryKind" AS ENUM ('CHARGE', 'REVERSAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CostInvoiceability" AS ENUM ('INVOICEABLE', 'PROVISIONAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CostSourceKind" AS ENUM ('VERCEL_FOCUS', 'MANUAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "InvoiceRequestStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CostEmailOutboxStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CostSyncTrigger" AS ENUM ('DEPLOYMENT', 'CRON', 'MANUAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CostSyncStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "CostLedgerConfig" (
  "id" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CostLedgerConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FxRateSnapshot" (
  "id" TEXT NOT NULL,
  "pair" TEXT NOT NULL,
  "rate" DECIMAL(20, 8) NOT NULL,
  "provider" TEXT NOT NULL,
  "captureDate" DATE NOT NULL,
  "effectiveDate" DATE NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FxRateSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CostSourceSnapshot" (
  "id" TEXT NOT NULL,
  "sourceKind" "CostSourceKind" NOT NULL,
  "bucketKey" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "checksum" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "classified" BOOLEAN NOT NULL,
  "quarantined" BOOLEAN NOT NULL DEFAULT false,
  "quarantineReason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CostSourceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CostEntry" (
  "id" TEXT NOT NULL,
  "category" "CostCategory" NOT NULL,
  "kind" "CostEntryKind" NOT NULL,
  "invoiceability" "CostInvoiceability" NOT NULL,
  "sourceKind" "CostSourceKind" NOT NULL,
  "sourceSnapshotId" TEXT NOT NULL,
  "reversesEntryId" TEXT,
  "fxRateSnapshotId" TEXT,
  "nativeAmount" DECIMAL(20, 8) NOT NULL,
  "nativeCurrency" TEXT NOT NULL,
  "markedGbpMinor" BIGINT NOT NULL,
  "servicePeriodStart" TIMESTAMP(3) NOT NULL,
  "servicePeriodEnd" TIMESTAMP(3) NOT NULL,
  "displayLabel" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CostEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CostSyncRun" (
  "id" TEXT NOT NULL,
  "trigger" "CostSyncTrigger" NOT NULL,
  "status" "CostSyncStatus" NOT NULL,
  "eventId" TEXT,
  "queryFrom" TIMESTAMP(3) NOT NULL,
  "queryTo" TIMESTAMP(3) NOT NULL,
  "checksum" TEXT,
  "classifiedCount" INTEGER NOT NULL DEFAULT 0,
  "quarantinedCount" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "CostSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InvoiceRequest" (
  "id" TEXT NOT NULL,
  "status" "InvoiceRequestStatus" NOT NULL,
  "openSlot" TEXT,
  "requesterUserId" TEXT NOT NULL,
  "confirmerUserId" TEXT,
  "frozenGbpMinor" BIGINT NOT NULL,
  "frozenEntryCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  CONSTRAINT "InvoiceRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InvoiceRequestLine" (
  "id" TEXT NOT NULL,
  "invoiceRequestId" TEXT NOT NULL,
  "costEntryId" TEXT NOT NULL,
  "markedGbpMinor" BIGINT NOT NULL,
  CONSTRAINT "InvoiceRequestLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CostSettlement" (
  "id" TEXT NOT NULL,
  "costEntryId" TEXT NOT NULL,
  "invoiceRequestId" TEXT NOT NULL,
  "markedGbpMinor" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CostSettlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CostWorkflowEvent" (
  "id" TEXT NOT NULL,
  "invoiceRequestId" TEXT,
  "type" TEXT NOT NULL,
  "actorUserId" TEXT,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CostWorkflowEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CostEmailOutbox" (
  "id" TEXT NOT NULL,
  "invoiceRequestId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" "CostEmailOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "providerMessageId" TEXT,
  "nextAttemptAt" TIMESTAMP(3),
  "claimedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  CONSTRAINT "CostEmailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FxRateSnapshot_pair_effectiveDate_provider_key"
  ON "FxRateSnapshot"("pair", "effectiveDate", "provider");
CREATE INDEX IF NOT EXISTS "FxRateSnapshot_pair_effectiveDate_idx"
  ON "FxRateSnapshot"("pair", "effectiveDate");

CREATE UNIQUE INDEX IF NOT EXISTS "CostSourceSnapshot_sourceKind_bucketKey_revision_key"
  ON "CostSourceSnapshot"("sourceKind", "bucketKey", "revision");
CREATE INDEX IF NOT EXISTS "CostSourceSnapshot_bucketKey_revision_idx"
  ON "CostSourceSnapshot"("bucketKey", "revision");
CREATE INDEX IF NOT EXISTS "CostSourceSnapshot_quarantined_createdAt_idx"
  ON "CostSourceSnapshot"("quarantined", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "CostEntry_sourceSnapshotId_kind_key"
  ON "CostEntry"("sourceSnapshotId", "kind");
CREATE UNIQUE INDEX IF NOT EXISTS "CostEntry_reversesEntryId_key"
  ON "CostEntry"("reversesEntryId");

CREATE TABLE IF NOT EXISTS "CostSyncLock" (
  "id" TEXT NOT NULL,
  "holder" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CostSyncLock_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CostEntry_category_createdAt_idx"
  ON "CostEntry"("category", "createdAt");
CREATE INDEX IF NOT EXISTS "CostEntry_invoiceability_createdAt_idx"
  ON "CostEntry"("invoiceability", "createdAt");
CREATE INDEX IF NOT EXISTS "CostEntry_createdAt_idx"
  ON "CostEntry"("createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "CostSyncRun_eventId_key"
  ON "CostSyncRun"("eventId");
CREATE INDEX IF NOT EXISTS "CostSyncRun_status_startedAt_idx"
  ON "CostSyncRun"("status", "startedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceRequest_openSlot_key"
  ON "InvoiceRequest"("openSlot");
CREATE INDEX IF NOT EXISTS "InvoiceRequest_status_createdAt_idx"
  ON "InvoiceRequest"("status", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceRequestLine_invoiceRequestId_costEntryId_key"
  ON "InvoiceRequestLine"("invoiceRequestId", "costEntryId");
CREATE INDEX IF NOT EXISTS "InvoiceRequestLine_costEntryId_idx"
  ON "InvoiceRequestLine"("costEntryId");

CREATE UNIQUE INDEX IF NOT EXISTS "CostSettlement_costEntryId_key"
  ON "CostSettlement"("costEntryId");
CREATE INDEX IF NOT EXISTS "CostSettlement_invoiceRequestId_idx"
  ON "CostSettlement"("invoiceRequestId");

CREATE INDEX IF NOT EXISTS "CostWorkflowEvent_invoiceRequestId_createdAt_idx"
  ON "CostWorkflowEvent"("invoiceRequestId", "createdAt");
CREATE INDEX IF NOT EXISTS "CostWorkflowEvent_type_createdAt_idx"
  ON "CostWorkflowEvent"("type", "createdAt");

CREATE INDEX IF NOT EXISTS "CostEmailOutbox_status_nextAttemptAt_idx"
  ON "CostEmailOutbox"("status", "nextAttemptAt");

ALTER TABLE "CostEntry"
  ADD CONSTRAINT "CostEntry_sourceSnapshotId_fkey"
  FOREIGN KEY ("sourceSnapshotId") REFERENCES "CostSourceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostEntry"
  ADD CONSTRAINT "CostEntry_reversesEntryId_fkey"
  FOREIGN KEY ("reversesEntryId") REFERENCES "CostEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostEntry"
  ADD CONSTRAINT "CostEntry_fxRateSnapshotId_fkey"
  FOREIGN KEY ("fxRateSnapshotId") REFERENCES "FxRateSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvoiceRequestLine"
  ADD CONSTRAINT "InvoiceRequestLine_invoiceRequestId_fkey"
  FOREIGN KEY ("invoiceRequestId") REFERENCES "InvoiceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceRequestLine"
  ADD CONSTRAINT "InvoiceRequestLine_costEntryId_fkey"
  FOREIGN KEY ("costEntryId") REFERENCES "CostEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CostSettlement"
  ADD CONSTRAINT "CostSettlement_costEntryId_fkey"
  FOREIGN KEY ("costEntryId") REFERENCES "CostEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostSettlement"
  ADD CONSTRAINT "CostSettlement_invoiceRequestId_fkey"
  FOREIGN KEY ("invoiceRequestId") REFERENCES "InvoiceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CostWorkflowEvent"
  ADD CONSTRAINT "CostWorkflowEvent_invoiceRequestId_fkey"
  FOREIGN KEY ("invoiceRequestId") REFERENCES "InvoiceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CostEmailOutbox"
  ADD CONSTRAINT "CostEmailOutbox_invoiceRequestId_fkey"
  FOREIGN KEY ("invoiceRequestId") REFERENCES "InvoiceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."CostLedgerConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."FxRateSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CostSourceSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CostEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CostSyncRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CostSyncLock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."InvoiceRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."InvoiceRequestLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CostSettlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CostWorkflowEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CostEmailOutbox" ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.cost_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'cost ledger rows are append-only';
END;
$$;

CREATE TRIGGER cost_ledger_config_immutable
  BEFORE UPDATE OR DELETE ON "CostLedgerConfig"
  FOR EACH ROW EXECUTE FUNCTION public.cost_forbid_mutation();
CREATE TRIGGER fx_rate_snapshot_immutable
  BEFORE UPDATE OR DELETE ON "FxRateSnapshot"
  FOR EACH ROW EXECUTE FUNCTION public.cost_forbid_mutation();
CREATE TRIGGER cost_source_snapshot_immutable
  BEFORE UPDATE OR DELETE ON "CostSourceSnapshot"
  FOR EACH ROW EXECUTE FUNCTION public.cost_forbid_mutation();
CREATE TRIGGER cost_entry_immutable
  BEFORE UPDATE OR DELETE ON "CostEntry"
  FOR EACH ROW EXECUTE FUNCTION public.cost_forbid_mutation();
CREATE TRIGGER invoice_request_line_immutable
  BEFORE UPDATE OR DELETE ON "InvoiceRequestLine"
  FOR EACH ROW EXECUTE FUNCTION public.cost_forbid_mutation();
CREATE TRIGGER cost_settlement_immutable
  BEFORE UPDATE OR DELETE ON "CostSettlement"
  FOR EACH ROW EXECUTE FUNCTION public.cost_forbid_mutation();
CREATE TRIGGER cost_workflow_event_immutable
  BEFORE UPDATE OR DELETE ON "CostWorkflowEvent"
  FOR EACH ROW EXECUTE FUNCTION public.cost_forbid_mutation();
