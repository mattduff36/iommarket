-- Account notification preferences. Additive only: missing rows stay opted in
-- through application defaults. No backfill and no Swift-specific changes.
-- Do not apply this migration as part of implementation or finalise.

CREATE TABLE "UserNotificationSettings" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "listingUpdates" BOOLEAN NOT NULL DEFAULT true,
  "dealerReviews" BOOLEAN NOT NULL DEFAULT true,
  "tradeMessages" BOOLEAN NOT NULL DEFAULT true,
  "tradeListingUpdates" BOOLEAN NOT NULL DEFAULT true,
  "tradeSavedSearchAlerts" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserNotificationSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserNotificationSettings_userId_key"
ON "UserNotificationSettings"("userId");

ALTER TABLE "UserNotificationSettings"
ADD CONSTRAINT "UserNotificationSettings_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."UserNotificationSettings" ENABLE ROW LEVEL SECURITY;
