ALTER TABLE "Listing" ADD COLUMN "stockReviewHeld" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StockReviewDraftReceipt"
  ADD COLUMN "recalledAt" TIMESTAMP(3),
  ADD COLUMN "recalledById" TEXT,
  ADD COLUMN "recalledReportId" TEXT;
CREATE INDEX "StockReviewDraftReceipt_dealerId_sourceIdentityKey_idx"
  ON "StockReviewDraftReceipt"("dealerId", "sourceIdentityKey");
