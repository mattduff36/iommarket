-- Expand-only: new enums/columns. Do not write REJECTED in this migration.

ALTER TYPE "ListingStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

CREATE TYPE "ListingLifecycleAction" AS ENUM (
  'SUBMIT',
  'APPROVE',
  'REJECT',
  'TAKE_DOWN',
  'EXPIRE',
  'MARK_SOLD',
  'RENEW',
  'REINSTATE_LIVE',
  'RETURN_TO_DRAFT',
  'ACCOUNT_DISABLE',
  'ACCOUNT_DISABLE_PENDING',
  'SYSTEM_BACKFILL'
);

CREATE TYPE "ListingModerationReason" AS ENUM (
  'FRAUD',
  'PROHIBITED',
  'MISLEADING',
  'DUPLICATE',
  'POLICY',
  'SAFETY',
  'ACCOUNT_DISABLED',
  'OTHER'
);

CREATE TYPE "ReportReasonCode" AS ENUM (
  'FRAUD',
  'PROHIBITED',
  'MISLEADING',
  'DUPLICATE',
  'POLICY',
  'SAFETY',
  'OTHER'
);

CREATE TYPE "UserDisableReason" AS ENUM (
  'POLICY',
  'FRAUD',
  'ABUSE',
  'CHARGEBACK',
  'OTHER'
);

CREATE TYPE "RefundReason" AS ENUM (
  'DUPLICATE',
  'REQUESTED_BY_CUSTOMER',
  'FRAUD',
  'SERVICE_NOT_PROVIDED',
  'OTHER'
);

CREATE TYPE "DealerReviewModerationReason" AS ENUM (
  'POLICY',
  'ABUSE',
  'SPAM',
  'OFF_TOPIC',
  'OTHER'
);

ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "lifecycleRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ListingStatusEvent" ADD COLUMN IF NOT EXISTS "action" "ListingLifecycleAction";
ALTER TABLE "ListingStatusEvent" ADD COLUMN IF NOT EXISTS "reasonCode" "ListingModerationReason";
ALTER TABLE "ListingStatusEvent" ADD COLUMN IF NOT EXISTS "reportId" TEXT;

ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "reasonCode" "ReportReasonCode";

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "disabledReasonCode" "UserDisableReason";

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "refundReason" "RefundReason";
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "refundedAt" TIMESTAMP(3);

ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "WaitlistUser" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "WaitlistUser" ADD COLUMN IF NOT EXISTS "deletedByAdminId" TEXT;
ALTER TABLE "WaitlistUser" ADD COLUMN IF NOT EXISTS "deletionReason" TEXT;

ALTER TABLE "ContentPage" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "DealerReviewModerationEvent" (
  "id" TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "fromStatus" "DealerReviewStatus",
  "toStatus" "DealerReviewStatus" NOT NULL,
  "reasonCode" "DealerReviewModerationReason",
  "adminNotes" TEXT,
  "changedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DealerReviewModerationEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MonitoringIssueStatusEvent" (
  "id" TEXT NOT NULL,
  "issueId" TEXT NOT NULL,
  "fromStatus" "MonitoringIssueStatus",
  "toStatus" "MonitoringIssueStatus" NOT NULL,
  "changedByUserId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MonitoringIssueStatusEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ListingStatusEvent_reportId_idx" ON "ListingStatusEvent"("reportId");
CREATE INDEX IF NOT EXISTS "WaitlistUser_deletedAt_idx" ON "WaitlistUser"("deletedAt");
CREATE INDEX IF NOT EXISTS "DealerReviewModerationEvent_reviewId_createdAt_idx" ON "DealerReviewModerationEvent"("reviewId", "createdAt");
CREATE INDEX IF NOT EXISTS "MonitoringIssueStatusEvent_issueId_createdAt_idx" ON "MonitoringIssueStatusEvent"("issueId", "createdAt");

ALTER TABLE "ListingStatusEvent"
  ADD CONSTRAINT "ListingStatusEvent_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DealerReviewModerationEvent"
  ADD CONSTRAINT "DealerReviewModerationEvent_reviewId_fkey"
  FOREIGN KEY ("reviewId") REFERENCES "DealerReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DealerReviewModerationEvent"
  ADD CONSTRAINT "DealerReviewModerationEvent_changedByUserId_fkey"
  FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MonitoringIssueStatusEvent"
  ADD CONSTRAINT "MonitoringIssueStatusEvent_issueId_fkey"
  FOREIGN KEY ("issueId") REFERENCES "MonitoringIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MonitoringIssueStatusEvent"
  ADD CONSTRAINT "MonitoringIssueStatusEvent_changedByUserId_fkey"
  FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
