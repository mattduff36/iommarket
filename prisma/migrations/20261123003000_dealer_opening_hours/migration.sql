ALTER TABLE "DealerProfile"
  ADD COLUMN "openingHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "openingHours" JSONB,
  ADD COLUMN "openingHoursSourceUrl" TEXT,
  ADD COLUMN "openingHoursCheckedAt" TIMESTAMP(3);
