ALTER TABLE "ListingStatusEvent"
  ADD COLUMN "moderationSubReason" TEXT,
  ADD COLUMN "moderationTaxonomyVersion" TEXT;

ALTER TABLE "ListingRevision"
  ADD COLUMN "moderationSubReason" TEXT,
  ADD COLUMN "moderationTaxonomyVersion" TEXT;
