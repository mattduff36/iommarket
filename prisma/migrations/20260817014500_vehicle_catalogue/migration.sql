CREATE TABLE "VehicleMake" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL,
  "sourceVersion" TEXT NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VehicleMake_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VehicleModel" (
  "id" TEXT NOT NULL,
  "makeId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL,
  "sourceVersion" TEXT NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VehicleModel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VehicleModelAlias" (
  "id" TEXT NOT NULL,
  "makeId" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL,
  "sourceVersion" TEXT NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VehicleModelAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VehicleMake_normalizedName_key"
  ON "VehicleMake"("normalizedName");
CREATE INDEX "VehicleMake_active_sortOrder_name_idx"
  ON "VehicleMake"("active", "sortOrder", "name");
CREATE INDEX "VehicleMake_source_sourceVersion_idx"
  ON "VehicleMake"("source", "sourceVersion");

CREATE UNIQUE INDEX "VehicleModel_makeId_normalizedName_key"
  ON "VehicleModel"("makeId", "normalizedName");
CREATE UNIQUE INDEX "VehicleModel_id_makeId_key"
  ON "VehicleModel"("id", "makeId");
CREATE INDEX "VehicleModel_makeId_active_sortOrder_name_idx"
  ON "VehicleModel"("makeId", "active", "sortOrder", "name");
CREATE INDEX "VehicleModel_source_sourceVersion_idx"
  ON "VehicleModel"("source", "sourceVersion");

CREATE UNIQUE INDEX "VehicleModelAlias_makeId_normalizedName_key"
  ON "VehicleModelAlias"("makeId", "normalizedName");
CREATE INDEX "VehicleModelAlias_normalizedName_active_idx"
  ON "VehicleModelAlias"("normalizedName", "active");
CREATE INDEX "VehicleModelAlias_modelId_active_sortOrder_idx"
  ON "VehicleModelAlias"("modelId", "active", "sortOrder");
CREATE INDEX "VehicleModelAlias_makeId_active_sortOrder_idx"
  ON "VehicleModelAlias"("makeId", "active", "sortOrder");
CREATE INDEX "VehicleModelAlias_source_sourceVersion_idx"
  ON "VehicleModelAlias"("source", "sourceVersion");

ALTER TABLE "VehicleModel"
  ADD CONSTRAINT "VehicleModel_makeId_fkey"
  FOREIGN KEY ("makeId") REFERENCES "VehicleMake"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VehicleModelAlias"
  ADD CONSTRAINT "VehicleModelAlias_modelId_makeId_fkey"
  FOREIGN KEY ("modelId", "makeId") REFERENCES "VehicleModel"("id", "makeId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VehicleModelAlias"
  ADD CONSTRAINT "VehicleModelAlias_makeId_fkey"
  FOREIGN KEY ("makeId") REFERENCES "VehicleMake"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "enforce_vehicle_model_name_uniqueness"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'VehicleModel' THEN
    IF EXISTS (
      SELECT 1
      FROM "VehicleModelAlias"
      WHERE "makeId" = NEW."makeId"
        AND "normalizedName" = NEW."normalizedName"
    ) THEN
      RAISE EXCEPTION 'vehicle model name conflicts with an alias for this make'
        USING ERRCODE = '23505';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM "VehicleModel"
      WHERE "id" = NEW."modelId"
        AND "makeId" = NEW."makeId"
    ) THEN
      RAISE EXCEPTION 'vehicle model alias make does not match its model'
        USING ERRCODE = '23503';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM "VehicleModel"
      WHERE "makeId" = NEW."makeId"
        AND "normalizedName" = NEW."normalizedName"
    ) THEN
      RAISE EXCEPTION 'vehicle model alias conflicts with a model name for this make'
        USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "VehicleModel_cross_name_unique"
  BEFORE INSERT OR UPDATE OF "makeId", "normalizedName"
  ON "VehicleModel"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_vehicle_model_name_uniqueness"();

CREATE TRIGGER "VehicleModelAlias_cross_name_unique"
  BEFORE INSERT OR UPDATE OF "makeId", "normalizedName"
  ON "VehicleModelAlias"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_vehicle_model_name_uniqueness"();

ALTER TABLE "public"."VehicleMake" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."VehicleModel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."VehicleModelAlias" ENABLE ROW LEVEL SECURITY;
