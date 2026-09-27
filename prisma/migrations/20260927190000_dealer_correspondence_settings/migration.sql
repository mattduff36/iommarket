-- Dealer correspondence preferences. Additive only: existing dealer mail
-- continues to use the login email until a dealer verifies a second address.
-- Do not apply this migration as part of implementation or finalise.

CREATE TYPE "DealerEmailCategory" AS ENUM (
  'BUYER_ENQUIRIES',
  'LISTING_UPDATES',
  'REVIEWS',
  'SUBSCRIPTION',
  'DEALER_ACCOUNT'
);

CREATE TABLE "DealerCorrespondenceSettings" (
  "id" TEXT NOT NULL,
  "dealerId" TEXT NOT NULL,
  "verifiedEmail" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "pendingEmail" TEXT,
  "verificationTokenHash" TEXT,
  "verificationExpiresAt" TIMESTAMP(3),
  "categories" "DealerEmailCategory"[] NOT NULL DEFAULT ARRAY[]::"DealerEmailCategory"[],
  "copyAssignedToPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DealerCorrespondenceSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DealerCorrespondenceSettings_dealerId_key"
ON "DealerCorrespondenceSettings"("dealerId");

CREATE UNIQUE INDEX "DealerCorrespondenceSettings_verificationTokenHash_key"
ON "DealerCorrespondenceSettings"("verificationTokenHash");

ALTER TABLE "DealerCorrespondenceSettings"
ADD CONSTRAINT "DealerCorrespondenceSettings_dealerId_fkey"
FOREIGN KEY ("dealerId") REFERENCES "DealerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DealerCorrespondenceSettings"
ADD CONSTRAINT "DealerCorrespondenceSettings_pending_check"
CHECK (
  (
    "pendingEmail" IS NULL
    AND "verificationTokenHash" IS NULL
    AND "verificationExpiresAt" IS NULL
  )
  OR
  (
    "pendingEmail" IS NOT NULL
    AND "verificationTokenHash" IS NOT NULL
    AND "verificationExpiresAt" IS NOT NULL
  )
);

ALTER TABLE "DealerCorrespondenceSettings"
ADD CONSTRAINT "DealerCorrespondenceSettings_email_check"
CHECK (
  (
    "verifiedEmail" IS NULL
    OR (
      "verifiedEmail" = lower("verifiedEmail")
      AND "verifiedEmail" = btrim("verifiedEmail")
      AND char_length("verifiedEmail") >= 3
    )
  )
  AND
  (
    "pendingEmail" IS NULL
    OR (
      "pendingEmail" = lower("pendingEmail")
      AND "pendingEmail" = btrim("pendingEmail")
      AND char_length("pendingEmail") >= 3
    )
  )
  AND
  (
    "verifiedEmail" IS NULL
    OR "pendingEmail" IS NULL
    OR "verifiedEmail" <> "pendingEmail"
  )
);

ALTER TABLE "public"."DealerCorrespondenceSettings" ENABLE ROW LEVEL SECURITY;
