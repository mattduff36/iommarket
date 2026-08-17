-- Additive dealer review responses, response revisions, disputes, and audit events.

CREATE TYPE "DealerReviewResponseRevisionStatus" AS ENUM (
  'DRAFT',
  'PENDING',
  'APPROVED',
  'REJECTED'
);

CREATE TYPE "DealerReviewDisputeStatus" AS ENUM (
  'OPEN',
  'RESOLVED',
  'REJECTED'
);

ALTER TABLE "DealerReview"
  ADD COLUMN "moderationVersion" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "DealerReview_moderationVersion_check"
    CHECK ("moderationVersion" >= 0);

ALTER TABLE "DealerReviewModerationEvent"
  ADD COLUMN "reviewVersion" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "DealerReviewModerationEvent_reviewVersion_check"
    CHECK ("reviewVersion" >= 0);

CREATE TABLE "DealerReviewResponse" (
  "id" TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "approvedBody" TEXT,
  "approvedRevisionId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DealerReviewResponse_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DealerReviewResponse_version_check" CHECK ("version" >= 0),
  CONSTRAINT "DealerReviewResponse_approved_state_check" CHECK (
    (
      "approvedBody" IS NULL
      AND "approvedRevisionId" IS NULL
      AND "approvedAt" IS NULL
    )
    OR
    (
      "approvedBody" IS NOT NULL
      AND btrim("approvedBody") <> ''
      AND "approvedRevisionId" IS NOT NULL
      AND "approvedAt" IS NOT NULL
    )
  )
);

CREATE TABLE "DealerReviewResponseRevision" (
  "id" TEXT NOT NULL,
  "responseId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" "DealerReviewResponseRevisionStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 0,
  "reasonCode" "DealerReviewModerationReason",
  "adminNotes" TEXT,
  "submittedAt" TIMESTAMP(3),
  "decidedAt" TIMESTAMP(3),
  "decidedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DealerReviewResponseRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DealerReviewResponseRevision_body_check" CHECK (btrim("body") <> ''),
  CONSTRAINT "DealerReviewResponseRevision_version_check" CHECK ("version" >= 0),
  CONSTRAINT "DealerReviewResponseRevision_lifecycle_check" CHECK (
    (
      "status" = 'DRAFT'
      AND "submittedAt" IS NULL
      AND "decidedAt" IS NULL
      AND "decidedByUserId" IS NULL
    )
    OR
    (
      "status" = 'PENDING'
      AND "submittedAt" IS NOT NULL
      AND "decidedAt" IS NULL
      AND "decidedByUserId" IS NULL
    )
    OR
    (
      "status" = 'APPROVED'
      AND "submittedAt" IS NOT NULL
      AND "decidedAt" IS NOT NULL
    )
    OR
    (
      "status" = 'REJECTED'
      AND "decidedAt" IS NOT NULL
    )
  ),
  CONSTRAINT "DealerReviewResponseRevision_rejection_reason_check" CHECK (
    "status" <> 'REJECTED' OR "reasonCode" IS NOT NULL
  )
);

CREATE TABLE "DealerReviewResponseModerationEvent" (
  "id" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "fromStatus" "DealerReviewResponseRevisionStatus" NOT NULL,
  "toStatus" "DealerReviewResponseRevisionStatus" NOT NULL,
  "reasonCode" "DealerReviewModerationReason",
  "adminNotes" TEXT,
  "revisionVersion" INTEGER NOT NULL,
  "responseVersion" INTEGER NOT NULL,
  "reviewVersion" INTEGER NOT NULL DEFAULT 0,
  "changedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DealerReviewResponseModerationEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DealerReviewResponseModerationEvent_versions_check" CHECK (
    "revisionVersion" >= 0
    AND "responseVersion" >= 0
    AND "reviewVersion" >= 0
  )
);

CREATE TABLE "DealerReviewDispute" (
  "id" TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "openedByUserId" TEXT,
  "reasonCode" "DealerReviewModerationReason" NOT NULL,
  "body" TEXT NOT NULL,
  "evidenceMetadata" JSONB,
  "status" "DealerReviewDisputeStatus" NOT NULL DEFAULT 'OPEN',
  "version" INTEGER NOT NULL DEFAULT 0,
  "decisionReasonCode" "DealerReviewModerationReason",
  "adminNotes" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decidedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DealerReviewDispute_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DealerReviewDispute_body_check" CHECK (btrim("body") <> ''),
  CONSTRAINT "DealerReviewDispute_version_check" CHECK ("version" >= 0),
  CONSTRAINT "DealerReviewDispute_lifecycle_check" CHECK (
    (
      "status" = 'OPEN'
      AND "decidedAt" IS NULL
      AND "decidedByUserId" IS NULL
      AND "decisionReasonCode" IS NULL
    )
    OR
    (
      "status" IN ('RESOLVED', 'REJECTED')
      AND "decidedAt" IS NOT NULL
      AND "decisionReasonCode" IS NOT NULL
    )
  )
);

CREATE TABLE "DealerReviewDisputeEvent" (
  "id" TEXT NOT NULL,
  "disputeId" TEXT NOT NULL,
  "fromStatus" "DealerReviewDisputeStatus" NOT NULL,
  "toStatus" "DealerReviewDisputeStatus" NOT NULL,
  "reasonCode" "DealerReviewModerationReason" NOT NULL,
  "adminNotes" TEXT,
  "disputeVersion" INTEGER NOT NULL,
  "reviewVersion" INTEGER NOT NULL DEFAULT 0,
  "changedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DealerReviewDisputeEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DealerReviewDisputeEvent_versions_check" CHECK (
    "disputeVersion" >= 0 AND "reviewVersion" >= 0
  )
);

CREATE UNIQUE INDEX "DealerReviewResponse_reviewId_key"
  ON "DealerReviewResponse"("reviewId");
CREATE UNIQUE INDEX "DealerReviewResponse_approvedRevisionId_key"
  ON "DealerReviewResponse"("approvedRevisionId");
CREATE UNIQUE INDEX "DealerReviewResponse_approvedRevisionId_id_key"
  ON "DealerReviewResponse"("approvedRevisionId", "id");
CREATE INDEX "DealerReviewResponse_reviewId_approvedAt_idx"
  ON "DealerReviewResponse"("reviewId", "approvedAt");

CREATE UNIQUE INDEX "DealerReviewResponseRevision_open_responseId_key"
  ON "DealerReviewResponseRevision"("responseId")
  WHERE "status" IN ('DRAFT', 'PENDING');
CREATE INDEX "DealerReviewResponseRevision_responseId_status_idx"
  ON "DealerReviewResponseRevision"("responseId", "status");
CREATE INDEX "DealerReviewResponseRevision_status_submittedAt_idx"
  ON "DealerReviewResponseRevision"("status", "submittedAt");
CREATE INDEX "DealerReviewResponseRevision_decidedByUserId_idx"
  ON "DealerReviewResponseRevision"("decidedByUserId");
CREATE UNIQUE INDEX "DealerReviewResponseRevision_id_responseId_key"
  ON "DealerReviewResponseRevision"("id", "responseId");

CREATE INDEX "DealerReviewResponseModerationEvent_revisionId_createdAt_idx"
  ON "DealerReviewResponseModerationEvent"("revisionId", "createdAt");
CREATE INDEX "DealerReviewResponseModerationEvent_changedByUserId_idx"
  ON "DealerReviewResponseModerationEvent"("changedByUserId");

CREATE UNIQUE INDEX "DealerReviewDispute_open_reviewId_key"
  ON "DealerReviewDispute"("reviewId")
  WHERE "status" = 'OPEN';
CREATE INDEX "DealerReviewDispute_reviewId_status_createdAt_idx"
  ON "DealerReviewDispute"("reviewId", "status", "createdAt");
CREATE INDEX "DealerReviewDispute_status_createdAt_idx"
  ON "DealerReviewDispute"("status", "createdAt");
CREATE INDEX "DealerReviewDispute_openedByUserId_idx"
  ON "DealerReviewDispute"("openedByUserId");
CREATE INDEX "DealerReviewDispute_decidedByUserId_idx"
  ON "DealerReviewDispute"("decidedByUserId");
CREATE INDEX "DealerReviewDisputeEvent_disputeId_createdAt_idx"
  ON "DealerReviewDisputeEvent"("disputeId", "createdAt");
CREATE INDEX "DealerReviewDisputeEvent_changedByUserId_idx"
  ON "DealerReviewDisputeEvent"("changedByUserId");

ALTER TABLE "DealerReviewResponse"
  ADD CONSTRAINT "DealerReviewResponse_reviewId_fkey"
  FOREIGN KEY ("reviewId") REFERENCES "DealerReview"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DealerReviewResponseRevision"
  ADD CONSTRAINT "DealerReviewResponseRevision_responseId_fkey"
  FOREIGN KEY ("responseId") REFERENCES "DealerReviewResponse"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DealerReviewResponseRevision"
  ADD CONSTRAINT "DealerReviewResponseRevision_decidedByUserId_fkey"
  FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DealerReviewResponse"
  ADD CONSTRAINT "DealerReviewResponse_approvedRevisionId_id_fkey"
  FOREIGN KEY ("approvedRevisionId", "id")
  REFERENCES "DealerReviewResponseRevision"("id", "responseId")
  ON DELETE NO ACTION ON UPDATE NO ACTION
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "DealerReviewResponseModerationEvent"
  ADD CONSTRAINT "DealerReviewResponseModerationEvent_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "DealerReviewResponseRevision"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DealerReviewResponseModerationEvent"
  ADD CONSTRAINT "DealerReviewResponseModerationEvent_changedByUserId_fkey"
  FOREIGN KEY ("changedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DealerReviewDispute"
  ADD CONSTRAINT "DealerReviewDispute_reviewId_fkey"
  FOREIGN KEY ("reviewId") REFERENCES "DealerReview"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DealerReviewDispute"
  ADD CONSTRAINT "DealerReviewDispute_openedByUserId_fkey"
  FOREIGN KEY ("openedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DealerReviewDisputeEvent"
  ADD CONSTRAINT "DealerReviewDisputeEvent_disputeId_fkey"
  FOREIGN KEY ("disputeId") REFERENCES "DealerReviewDispute"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DealerReviewDisputeEvent"
  ADD CONSTRAINT "DealerReviewDisputeEvent_changedByUserId_fkey"
  FOREIGN KEY ("changedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE FUNCTION "check_dealer_review_response_approved_revision"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected_response_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'DealerReviewResponse' THEN
      affected_response_id := OLD.id;
    ELSIF TG_TABLE_NAME = 'DealerReviewResponseRevision' THEN
      affected_response_id := OLD."responseId";
    ELSE
      RAISE EXCEPTION 'Unexpected approved-response trigger table: %', TG_TABLE_NAME;
    END IF;
  ELSE
    IF TG_TABLE_NAME = 'DealerReviewResponse' THEN
      affected_response_id := NEW.id;
    ELSIF TG_TABLE_NAME = 'DealerReviewResponseRevision' THEN
      affected_response_id := NEW."responseId";
    ELSE
      RAISE EXCEPTION 'Unexpected approved-response trigger table: %', TG_TABLE_NAME;
    END IF;
  END IF;

  IF affected_response_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "DealerReviewResponse" response
    LEFT JOIN "DealerReviewResponseRevision" revision
      ON revision.id = response."approvedRevisionId"
      AND revision."responseId" = response.id
    WHERE response.id = affected_response_id
      AND response."approvedRevisionId" IS NOT NULL
      AND (
        revision.id IS NULL
        OR revision.status <> 'APPROVED'
        OR revision.body IS DISTINCT FROM response."approvedBody"
      )
  ) THEN
    RAISE EXCEPTION 'Approved dealer response must reference its own approved revision';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "DealerReviewResponse_approved_revision_check"
AFTER INSERT OR UPDATE ON "DealerReviewResponse"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW."approvedRevisionId" IS NOT NULL)
EXECUTE FUNCTION "check_dealer_review_response_approved_revision"();

CREATE CONSTRAINT TRIGGER "DealerReviewResponseRevision_approved_reference_check"
AFTER INSERT OR UPDATE OR DELETE ON "DealerReviewResponseRevision"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "check_dealer_review_response_approved_revision"();

ALTER TABLE "DealerReviewDispute"
  ADD CONSTRAINT "DealerReviewDispute_decidedByUserId_fkey"
  FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Keep dealer-authored drafts and disputes private from PostgREST.
-- Prisma connects with the server-side database role; no client policies are added.
ALTER TABLE "public"."DealerReviewResponse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."DealerReviewResponseRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."DealerReviewResponseModerationEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."DealerReviewDispute" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."DealerReviewDisputeEvent" ENABLE ROW LEVEL SECURITY;
