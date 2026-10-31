ALTER TABLE "UserNotificationSettings" ADD COLUMN "draftListings" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "StockReviewDraftReceipt" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "actionKey" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "revisionId" TEXT,
  "dealerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceIdentityKey" TEXT,
  "source" JSONB NOT NULL,
  "blockers" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "reviewAcknowledgedAt" TIMESTAMP(3),
  "acknowledgedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockReviewDraftReceipt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StockReviewDraftReceipt_reportId_actionKey_key" ON "StockReviewDraftReceipt"("reportId", "actionKey");
CREATE INDEX "StockReviewDraftReceipt_listingId_revisionId_idx" ON "StockReviewDraftReceipt"("listingId", "revisionId");
ALTER TABLE "StockReviewDraftReceipt" ADD CONSTRAINT "StockReviewDraftReceipt_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockReviewDraftReceipt" ADD CONSTRAINT "StockReviewDraftReceipt_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ListingRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockReviewDraftReceipt" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "StockReviewDraftReceipt" FROM anon, authenticated;
