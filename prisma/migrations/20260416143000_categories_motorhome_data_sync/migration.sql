-- Normalize vehicle category display names and ensure motorhome category support.
DO $$
DECLARE
  car_category_id TEXT;
  van_category_id TEXT;
  motorhome_category_id TEXT;
BEGIN
  UPDATE "Category"
  SET name = 'Cars', "sortOrder" = 1, active = TRUE
  WHERE slug = 'car';

  UPDATE "Category"
  SET name = 'Vans', "sortOrder" = 2, active = TRUE
  WHERE slug = 'van';

  UPDATE "Category"
  SET name = 'Motorbikes', "sortOrder" = 3, active = TRUE
  WHERE slug = 'motorbike';

  SELECT id
  INTO motorhome_category_id
  FROM "Category"
  WHERE slug = 'motorhome'
  LIMIT 1;

  IF motorhome_category_id IS NULL THEN
    motorhome_category_id :=
      'motorhome_' || substr(md5(random()::text || clock_timestamp()::text), 1, 20);

    INSERT INTO "Category" (id, name, slug, "parentId", active, "sortOrder", "createdAt")
    VALUES (motorhome_category_id, 'Motorhomes', 'motorhome', NULL, TRUE, 4, NOW());
  ELSE
    UPDATE "Category"
    SET name = 'Motorhomes', "sortOrder" = 4, active = TRUE
    WHERE id = motorhome_category_id;
  END IF;

  SELECT id
  INTO van_category_id
  FROM "Category"
  WHERE slug = 'van'
  LIMIT 1;

  IF van_category_id IS NOT NULL THEN
    INSERT INTO "AttributeDefinition" (
      id,
      "categoryId",
      name,
      slug,
      "dataType",
      required,
      options,
      "sortOrder"
    )
    SELECT
      'motorhome_attr_' || substr(md5(src.slug || random()::text || clock_timestamp()::text), 1, 20),
      motorhome_category_id,
      src.name,
      src.slug,
      src."dataType",
      src.required,
      src.options,
      src."sortOrder"
    FROM "AttributeDefinition" AS src
    WHERE src."categoryId" = van_category_id
      AND NOT EXISTS (
        SELECT 1
        FROM "AttributeDefinition" AS dest
        WHERE dest."categoryId" = motorhome_category_id
          AND dest.slug = src.slug
      );
  END IF;

  -- Ensure core fields exist even if van definitions were incomplete.
  SELECT id
  INTO car_category_id
  FROM "Category"
  WHERE slug = 'car'
  LIMIT 1;

  IF car_category_id IS NOT NULL THEN
    INSERT INTO "AttributeDefinition" (
      id,
      "categoryId",
      name,
      slug,
      "dataType",
      required,
      options,
      "sortOrder"
    )
    SELECT
      'motorhome_attr_' || substr(md5(src.slug || random()::text || clock_timestamp()::text), 1, 20),
      motorhome_category_id,
      src.name,
      src.slug,
      src."dataType",
      src.required,
      src.options,
      src."sortOrder"
    FROM "AttributeDefinition" AS src
    WHERE src."categoryId" = car_category_id
      AND src.slug IN ('make', 'model', 'year', 'mileage', 'fuel-type', 'transmission')
      AND NOT EXISTS (
        SELECT 1
        FROM "AttributeDefinition" AS dest
        WHERE dest."categoryId" = motorhome_category_id
          AND dest.slug = src.slug
      );
  END IF;
END $$;
