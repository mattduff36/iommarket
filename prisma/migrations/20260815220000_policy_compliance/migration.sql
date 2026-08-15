-- Additive policy, cancellation, deletion, and retention schema.
-- Enforcement remains flag-gated. Historical payment and audit rows are untouched.

ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "retentionPurgedAt" TIMESTAMP(3);
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);
ALTER TABLE "DealerReview" ADD COLUMN IF NOT EXISTS "removedAt" TIMESTAMP(3);
ALTER TABLE "ListingView" ADD COLUMN IF NOT EXISTS "viewerHashVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "WaitlistUser" ADD COLUMN IF NOT EXISTS "marketingConsentAt" TIMESTAMP(3);
ALTER TABLE "WaitlistUser" ADD COLUMN IF NOT EXISTS "marketingPolicyVersion" TEXT;
ALTER TABLE "WaitlistUser" ADD COLUMN IF NOT EXISTS "marketingWithdrawnAt" TIMESTAMP(3);

DO $$ BEGIN
  CREATE TYPE "PolicyAcceptanceType" AS ENUM (
    'AGE_18',
    'ACCOUNT_BUNDLE',
    'LISTING_BUNDLE',
    'DEALER_BUNDLE',
    'PRIVACY_NOTICE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PolicyAcceptanceSource" AS ENUM (
    'SIGNUP',
    'GATE',
    'LISTING',
    'SUBSCRIBE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CancellationRequestStatus" AS ENUM (
    'REQUESTED',
    'ACKNOWLEDGED',
    'RECONCILED',
    'COMPLETED',
    'REJECTED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AccountDeletionJobStatus" AS ENUM (
    'REQUESTED',
    'PROCESSING',
    'COMPLETED',
    'FAILED',
    'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AccountDeletionPhase" AS ENUM (
    'REQUESTED',
    'AUTH',
    'MEDIA',
    'ANONYMISE',
    'COMPLETED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PolicyAcceptance" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "acceptanceType" "PolicyAcceptanceType" NOT NULL,
  "bundleVersion" TEXT NOT NULL,
  "policyVersions" JSONB NOT NULL,
  "source" "PolicyAcceptanceSource" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PolicyAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PolicyAcceptance_userId_acceptanceType_bundleVersion_key"
  ON "PolicyAcceptance"("userId", "acceptanceType", "bundleVersion");
CREATE INDEX IF NOT EXISTS "PolicyAcceptance_userId_acceptanceType_idx"
  ON "PolicyAcceptance"("userId", "acceptanceType");

CREATE TABLE IF NOT EXISTS "DealerCancellationRequest" (
  "id" TEXT NOT NULL,
  "dealerId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "status" "CancellationRequestStatus" NOT NULL DEFAULT 'REQUESTED',
  "idempotencyKey" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "periodEndAt" TIMESTAMP(3) NOT NULL,
  "processedAt" TIMESTAMP(3),
  "processedByAdminId" TEXT,
  "notes" TEXT,
  "lastError" TEXT,
  CONSTRAINT "DealerCancellationRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DealerCancellationRequest_idempotencyKey_key"
  ON "DealerCancellationRequest"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "DealerCancellationRequest_open_subscriptionId_key"
  ON "DealerCancellationRequest"("subscriptionId")
  WHERE "status" IN ('REQUESTED', 'ACKNOWLEDGED', 'RECONCILED');
CREATE INDEX IF NOT EXISTS "DealerCancellationRequest_dealerId_status_idx"
  ON "DealerCancellationRequest"("dealerId", "status");
CREATE INDEX IF NOT EXISTS "DealerCancellationRequest_subscriptionId_status_idx"
  ON "DealerCancellationRequest"("subscriptionId", "status");

CREATE TABLE IF NOT EXISTS "DealerCancellationRequestEvent" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "fromStatus" "CancellationRequestStatus",
  "toStatus" "CancellationRequestStatus" NOT NULL,
  "actorUserId" TEXT,
  "source" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DealerCancellationRequestEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DealerCancellationRequestEvent_requestId_createdAt_idx"
  ON "DealerCancellationRequestEvent"("requestId", "createdAt");

CREATE TABLE IF NOT EXISTS "AccountDeletionJob" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "AccountDeletionJobStatus" NOT NULL DEFAULT 'REQUESTED',
  "phase" "AccountDeletionPhase" NOT NULL DEFAULT 'REQUESTED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "lockedAt" TIMESTAMP(3),
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "AccountDeletionJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AccountDeletionJob_userId_key"
  ON "AccountDeletionJob"("userId");
CREATE INDEX IF NOT EXISTS "AccountDeletionJob_status_nextAttemptAt_idx"
  ON "AccountDeletionJob"("status", "nextAttemptAt");

CREATE TABLE IF NOT EXISTS "RetentionLegalHold" (
  "id" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  CONSTRAINT "RetentionLegalHold_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RetentionLegalHold_active_entity_key"
  ON "RetentionLegalHold"("entityType", "entityId")
  WHERE "releasedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "RetentionLegalHold_entityType_entityId_idx"
  ON "RetentionLegalHold"("entityType", "entityId");

CREATE TABLE IF NOT EXISTS "RetentionRun" (
  "id" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "entityTypes" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "counts" JSONB,
  "sampleIds" JSONB,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "RetentionRun_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "PolicyAcceptance"
    ADD CONSTRAINT "PolicyAcceptance_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "DealerCancellationRequest"
    ADD CONSTRAINT "DealerCancellationRequest_dealerId_fkey"
    FOREIGN KEY ("dealerId") REFERENCES "DealerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "DealerCancellationRequest"
    ADD CONSTRAINT "DealerCancellationRequest_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "DealerCancellationRequest"
    ADD CONSTRAINT "DealerCancellationRequest_requestedByUserId_fkey"
    FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "DealerCancellationRequest"
    ADD CONSTRAINT "DealerCancellationRequest_processedByAdminId_fkey"
    FOREIGN KEY ("processedByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "DealerCancellationRequestEvent"
    ADD CONSTRAINT "DealerCancellationRequestEvent_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "DealerCancellationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "DealerCancellationRequestEvent"
    ADD CONSTRAINT "DealerCancellationRequestEvent_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AccountDeletionJob"
    ADD CONSTRAINT "AccountDeletionJob_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO "AttributeDefinition" (
  "id",
  "categoryId",
  "name",
  "slug",
  "dataType",
  "required",
  "options",
  "sortOrder"
)
SELECT
  concat('attr_writeoff_', c."id"),
  c."id",
  'Insurance write-off category',
  'write-off-category',
  'select',
  false,
  '["None","Category N","Category S"]',
  22
FROM "Category" c
WHERE c."slug" IN ('car', 'van', 'motorbike', 'motorhome')
  AND NOT EXISTS (
    SELECT 1
    FROM "AttributeDefinition" existing
    WHERE existing."categoryId" = c."id"
      AND existing."slug" = 'write-off-category'
  );

ALTER TABLE "public"."PolicyAcceptance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."DealerCancellationRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."DealerCancellationRequestEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."AccountDeletionJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."RetentionLegalHold" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."RetentionRun" ENABLE ROW LEVEL SECURITY;
