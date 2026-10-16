-- Private Trade Exchange tables. Additive only.
-- Apply to the isolated local database and the verified preview database.
-- Do not apply to production until the product owner confirms.

CREATE TYPE "TradeEntityType" AS ENUM (
  'REGISTERED_COMPANY',
  'REGISTERED_BUSINESS_NAME',
  'SOLE_TRADER_OR_PARTNERSHIP',
  'OTHER'
);

CREATE TYPE "TradeMembershipStatus" AS ENUM (
  'PENDING',
  'NEEDS_INFO',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
  'REVOKED'
);

CREATE TYPE "TradeListingStatus" AS ENUM (
  'DRAFT',
  'PENDING_REVIEW',
  'LIVE',
  'RESERVED',
  'SOLD',
  'WITHDRAWN',
  'EXPIRED',
  'REMOVED'
);

CREATE TYPE "TradePriceType" AS ENUM ('FIXED', 'POA', 'OFFERS_INVITED');

CREATE TYPE "TradeVatTreatment" AS ENUM (
  'PLUS_VAT',
  'VAT_INCLUDED',
  'NO_VAT',
  'NOT_STATED'
);

CREATE TYPE "TradeContactPreference" AS ENUM ('MESSAGE', 'PHONE', 'EITHER');

CREATE TYPE "TradeEnquiryStatus" AS ENUM (
  'OPEN',
  'WITHDRAWN',
  'DECLINED',
  'ACCEPTED_IN_PRINCIPLE',
  'CLOSED'
);

CREATE TYPE "TradeReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'REJECTED');

CREATE TYPE "TradeEventSource" AS ENUM ('USER', 'ADMIN', 'SYSTEM');

CREATE TABLE "TradeMembership" (
  "id" TEXT NOT NULL,
  "dealerId" TEXT NOT NULL,
  "status" "TradeMembershipStatus" NOT NULL DEFAULT 'PENDING',
  "businessName" TEXT NOT NULL,
  "legalEntityName" TEXT,
  "entityType" "TradeEntityType" NOT NULL,
  "registrationIdentifier" TEXT,
  "tradingAddress" TEXT NOT NULL,
  "website" TEXT,
  "contactName" TEXT NOT NULL,
  "roleDeclaration" TEXT NOT NULL,
  "workEmail" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "activityDescription" TEXT NOT NULL,
  "evidenceFileId" TEXT,
  "evidenceFilePath" TEXT,
  "evidenceFileName" TEXT,
  "duplicateRegistration" BOOLEAN NOT NULL DEFAULT false,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedByUserId" TEXT,
  "reasonCode" TEXT,
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TradeMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TradeMembershipEvent" (
  "id" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "dealerId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "fromStatus" "TradeMembershipStatus",
  "toStatus" "TradeMembershipStatus" NOT NULL,
  "reasonCode" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeMembershipEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TradeListing" (
  "id" TEXT NOT NULL,
  "dealerId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "status" "TradeListingStatus" NOT NULL DEFAULT 'DRAFT',
  "make" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "mileage" INTEGER NOT NULL,
  "transmission" TEXT NOT NULL,
  "fuel" TEXT NOT NULL,
  "conditionSummary" TEXT NOT NULL,
  "disclosedDefects" TEXT NOT NULL,
  "serviceHistory" TEXT,
  "motStatus" TEXT,
  "priceType" "TradePriceType" NOT NULL,
  "pricePence" INTEGER,
  "vatTreatment" "TradeVatTreatment" NOT NULL,
  "registrationNumber" TEXT,
  "vin" TEXT,
  "locationLabel" TEXT NOT NULL,
  "notes" TEXT,
  "contactPreference" "TradeContactPreference" NOT NULL DEFAULT 'MESSAGE',
  "availabilityNote" TEXT,
  "ownershipDeclared" BOOLEAN NOT NULL DEFAULT false,
  "authorityDeclared" BOOLEAN NOT NULL DEFAULT false,
  "mileageDeclared" BOOLEAN NOT NULL DEFAULT false,
  "conditionDeclared" BOOLEAN NOT NULL DEFAULT false,
  "notWrittenOffDeclared" BOOLEAN NOT NULL DEFAULT false,
  "publishedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "reservedAt" TIMESTAMP(3),
  "soldAt" TIMESTAMP(3),
  "withdrawnAt" TIMESTAMP(3),
  "removedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TradeListing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TradeListingImage" (
  "id" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "bytes" INTEGER NOT NULL,
  "contentType" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeListingImage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TradeListingEvent" (
  "id" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "fromStatus" "TradeListingStatus",
  "toStatus" "TradeListingStatus" NOT NULL,
  "source" "TradeEventSource" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeListingEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TradeEnquiry" (
  "id" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "fromDealerId" TEXT NOT NULL,
  "toDealerId" TEXT NOT NULL,
  "status" "TradeEnquiryStatus" NOT NULL DEFAULT 'OPEN',
  "offerPence" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TradeEnquiry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TradeMessage" (
  "id" TEXT NOT NULL,
  "enquiryId" TEXT NOT NULL,
  "senderDealerId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TradeReport" (
  "id" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "reporterDealerId" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "details" TEXT NOT NULL,
  "status" "TradeReportStatus" NOT NULL DEFAULT 'OPEN',
  "resolvedByUserId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TradeSavedSearch" (
  "id" TEXT NOT NULL,
  "dealerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "filters" JSONB NOT NULL,
  "lastNotifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TradeSavedSearch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TradeImportBatch" (
  "id" TEXT NOT NULL,
  "dealerId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "createdCount" INTEGER NOT NULL,
  "errorCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TradeMetricEvent" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "dealerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeMetricEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TradeEvidenceAccess" (
  "id" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeEvidenceAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TradeMembership_dealerId_key" ON "TradeMembership"("dealerId");
CREATE INDEX "TradeMembership_status_submittedAt_idx" ON "TradeMembership"("status", "submittedAt");
CREATE INDEX "TradeMembership_registrationIdentifier_idx" ON "TradeMembership"("registrationIdentifier");
CREATE INDEX "TradeMembership_reviewedByUserId_idx" ON "TradeMembership"("reviewedByUserId");
CREATE INDEX "TradeMembershipEvent_membershipId_createdAt_idx" ON "TradeMembershipEvent"("membershipId", "createdAt");
CREATE INDEX "TradeMembershipEvent_dealerId_createdAt_idx" ON "TradeMembershipEvent"("dealerId", "createdAt");
CREATE INDEX "TradeMembershipEvent_actorUserId_idx" ON "TradeMembershipEvent"("actorUserId");
CREATE INDEX "TradeListing_dealerId_status_idx" ON "TradeListing"("dealerId", "status");
CREATE INDEX "TradeListing_status_publishedAt_idx" ON "TradeListing"("status", "publishedAt");
CREATE INDEX "TradeListing_status_expiresAt_idx" ON "TradeListing"("status", "expiresAt");
CREATE INDEX "TradeListing_make_model_idx" ON "TradeListing"("make", "model");
CREATE INDEX "TradeListing_createdByUserId_idx" ON "TradeListing"("createdByUserId");
CREATE INDEX "TradeListingImage_listingId_sortOrder_idx" ON "TradeListingImage"("listingId", "sortOrder");
CREATE INDEX "TradeListingEvent_listingId_createdAt_idx" ON "TradeListingEvent"("listingId", "createdAt");
CREATE INDEX "TradeListingEvent_actorUserId_idx" ON "TradeListingEvent"("actorUserId");
CREATE UNIQUE INDEX "TradeEnquiry_listingId_fromDealerId_key" ON "TradeEnquiry"("listingId", "fromDealerId");
CREATE INDEX "TradeEnquiry_toDealerId_status_idx" ON "TradeEnquiry"("toDealerId", "status");
CREATE INDEX "TradeEnquiry_fromDealerId_status_idx" ON "TradeEnquiry"("fromDealerId", "status");
CREATE INDEX "TradeMessage_enquiryId_createdAt_idx" ON "TradeMessage"("enquiryId", "createdAt");
CREATE INDEX "TradeMessage_senderDealerId_idx" ON "TradeMessage"("senderDealerId");
CREATE INDEX "TradeReport_status_createdAt_idx" ON "TradeReport"("status", "createdAt");
CREATE INDEX "TradeReport_listingId_idx" ON "TradeReport"("listingId");
CREATE INDEX "TradeReport_reporterDealerId_idx" ON "TradeReport"("reporterDealerId");
CREATE INDEX "TradeReport_resolvedByUserId_idx" ON "TradeReport"("resolvedByUserId");
CREATE INDEX "TradeSavedSearch_dealerId_createdAt_idx" ON "TradeSavedSearch"("dealerId", "createdAt");
CREATE INDEX "TradeImportBatch_dealerId_createdAt_idx" ON "TradeImportBatch"("dealerId", "createdAt");
CREATE INDEX "TradeImportBatch_createdByUserId_idx" ON "TradeImportBatch"("createdByUserId");
CREATE INDEX "TradeMetricEvent_kind_createdAt_idx" ON "TradeMetricEvent"("kind", "createdAt");
CREATE INDEX "TradeMetricEvent_dealerId_createdAt_idx" ON "TradeMetricEvent"("dealerId", "createdAt");
CREATE INDEX "TradeEvidenceAccess_membershipId_createdAt_idx" ON "TradeEvidenceAccess"("membershipId", "createdAt");
CREATE INDEX "TradeEvidenceAccess_actorUserId_idx" ON "TradeEvidenceAccess"("actorUserId");

ALTER TABLE "TradeMembership"
ADD CONSTRAINT "TradeMembership_dealerId_fkey"
FOREIGN KEY ("dealerId") REFERENCES "DealerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradeMembership"
ADD CONSTRAINT "TradeMembership_reviewedByUserId_fkey"
FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TradeMembershipEvent"
ADD CONSTRAINT "TradeMembershipEvent_membershipId_fkey"
FOREIGN KEY ("membershipId") REFERENCES "TradeMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradeMembershipEvent"
ADD CONSTRAINT "TradeMembershipEvent_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TradeListing"
ADD CONSTRAINT "TradeListing_dealerId_fkey"
FOREIGN KEY ("dealerId") REFERENCES "DealerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradeListing"
ADD CONSTRAINT "TradeListing_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TradeListingImage"
ADD CONSTRAINT "TradeListingImage_listingId_fkey"
FOREIGN KEY ("listingId") REFERENCES "TradeListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradeListingEvent"
ADD CONSTRAINT "TradeListingEvent_listingId_fkey"
FOREIGN KEY ("listingId") REFERENCES "TradeListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradeListingEvent"
ADD CONSTRAINT "TradeListingEvent_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TradeEnquiry"
ADD CONSTRAINT "TradeEnquiry_listingId_fkey"
FOREIGN KEY ("listingId") REFERENCES "TradeListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradeEnquiry"
ADD CONSTRAINT "TradeEnquiry_fromDealerId_fkey"
FOREIGN KEY ("fromDealerId") REFERENCES "DealerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradeEnquiry"
ADD CONSTRAINT "TradeEnquiry_toDealerId_fkey"
FOREIGN KEY ("toDealerId") REFERENCES "DealerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradeMessage"
ADD CONSTRAINT "TradeMessage_enquiryId_fkey"
FOREIGN KEY ("enquiryId") REFERENCES "TradeEnquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradeMessage"
ADD CONSTRAINT "TradeMessage_senderDealerId_fkey"
FOREIGN KEY ("senderDealerId") REFERENCES "DealerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradeReport"
ADD CONSTRAINT "TradeReport_listingId_fkey"
FOREIGN KEY ("listingId") REFERENCES "TradeListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradeReport"
ADD CONSTRAINT "TradeReport_reporterDealerId_fkey"
FOREIGN KEY ("reporterDealerId") REFERENCES "DealerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradeReport"
ADD CONSTRAINT "TradeReport_resolvedByUserId_fkey"
FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TradeSavedSearch"
ADD CONSTRAINT "TradeSavedSearch_dealerId_fkey"
FOREIGN KEY ("dealerId") REFERENCES "DealerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradeImportBatch"
ADD CONSTRAINT "TradeImportBatch_dealerId_fkey"
FOREIGN KEY ("dealerId") REFERENCES "DealerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradeImportBatch"
ADD CONSTRAINT "TradeImportBatch_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TradeEvidenceAccess"
ADD CONSTRAINT "TradeEvidenceAccess_membershipId_fkey"
FOREIGN KEY ("membershipId") REFERENCES "TradeMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradeEvidenceAccess"
ADD CONSTRAINT "TradeEvidenceAccess_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TradeListing"
ADD CONSTRAINT "TradeListing_price_check"
CHECK (
  ("priceType" = 'FIXED' AND "pricePence" IS NOT NULL AND "pricePence" > 0)
  OR ("priceType" IN ('POA', 'OFFERS_INVITED') AND "pricePence" IS NULL)
);

ALTER TABLE "TradeListing"
ADD CONSTRAINT "TradeListing_publish_check"
CHECK (
  "status" NOT IN ('LIVE', 'RESERVED')
  OR (
    "publishedAt" IS NOT NULL
    AND "expiresAt" IS NOT NULL
    AND "ownershipDeclared" = true
    AND "authorityDeclared" = true
    AND "mileageDeclared" = true
    AND "conditionDeclared" = true
    AND "notWrittenOffDeclared" = true
  )
);

ALTER TABLE "TradeEnquiry"
ADD CONSTRAINT "TradeEnquiry_offer_check"
CHECK ("offerPence" IS NULL OR "offerPence" > 0);

ALTER TABLE "TradeMessage"
ADD CONSTRAINT "TradeMessage_body_check"
CHECK (char_length("body") BETWEEN 1 AND 2000);

ALTER TABLE "public"."TradeMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."TradeMembershipEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."TradeListing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."TradeListingImage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."TradeListingEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."TradeEnquiry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."TradeMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."TradeReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."TradeSavedSearch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."TradeImportBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."TradeMetricEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."TradeEvidenceAccess" ENABLE ROW LEVEL SECURITY;
