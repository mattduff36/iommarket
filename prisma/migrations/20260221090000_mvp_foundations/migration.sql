ALTER TABLE "Listing"
ADD COLUMN IF NOT EXISTS "slug" TEXT,
ADD COLUMN IF NOT EXISTS "viewCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "DealerProfile"
ADD COLUMN IF NOT EXISTS "verified" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Listing_slug_idx" ON "Listing"("slug");

CREATE TABLE IF NOT EXISTS "Favourite" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Favourite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Favourite_userId_listingId_key"
ON "Favourite"("userId", "listingId");
CREATE INDEX IF NOT EXISTS "Favourite_userId_idx" ON "Favourite"("userId");
CREATE INDEX IF NOT EXISTS "Favourite_listingId_idx" ON "Favourite"("listingId");

DO $$ BEGIN
  ALTER TABLE "Favourite"
  ADD CONSTRAINT "Favourite_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Favourite"
  ADD CONSTRAINT "Favourite_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "SavedSearch" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "queryParamsJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SavedSearch_userId_idx" ON "SavedSearch"("userId");

DO $$ BEGIN
  ALTER TABLE "SavedSearch"
  ADD CONSTRAINT "SavedSearch_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "ListingView" (
  "id" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "viewerId" TEXT,
  "viewerHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ListingView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ListingView_listingId_createdAt_idx"
ON "ListingView"("listingId", "createdAt");
CREATE INDEX IF NOT EXISTS "ListingView_viewerHash_createdAt_idx"
ON "ListingView"("viewerHash", "createdAt");

DO $$ BEGIN
  ALTER TABLE "ListingView"
  ADD CONSTRAINT "ListingView_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ListingView"
  ADD CONSTRAINT "ListingView_viewerId_fkey"
  FOREIGN KEY ("viewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
