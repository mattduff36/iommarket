BEGIN;

ALTER TABLE "Region"
ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

INSERT INTO "Region" ("id", "name", "slug", "active", "sortOrder", "createdAt")
VALUES
  ('cmregioniomnorth0000000001', 'IOM North', 'iom-north', true, 1, CURRENT_TIMESTAMP),
  ('cmregioniomsouth0000000002', 'IOM South', 'iom-south', true, 2, CURRENT_TIMESTAMP),
  ('cmregioniomeast00000000003', 'IOM East', 'iom-east', true, 3, CURRENT_TIMESTAMP),
  ('cmregioniomwest00000000004', 'IOM West', 'iom-west', true, 4, CURRENT_TIMESTAMP),
  ('cmregioniomcentral000000005', 'IOM Central', 'iom-central', true, 5, CURRENT_TIMESTAMP),
  ('cmregionunitedkingdom000006', 'United Kingdom', 'uk', true, 6, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "active" = EXCLUDED."active",
  "sortOrder" = EXCLUDED."sortOrder";

WITH region_mapping("oldSlug", "newSlug") AS (
  VALUES
    ('ramsey', 'iom-north'),
    ('castletown', 'iom-south'),
    ('port-erin', 'iom-south'),
    ('port-st-mary', 'iom-south'),
    ('ballasalla', 'iom-south'),
    ('douglas', 'iom-east'),
    ('onchan', 'iom-east'),
    ('laxey', 'iom-east'),
    ('peel', 'iom-west'),
    ('kirk-michael', 'iom-west'),
    ('isle-of-man', 'iom-central')
)
UPDATE "Listing" AS listing
SET "regionId" = target_region."id"
FROM
  region_mapping,
  "Region" AS source_region,
  "Region" AS target_region
WHERE
  source_region."slug" = region_mapping."oldSlug"
  AND target_region."slug" = region_mapping."newSlug"
  AND listing."regionId" = source_region."id";

WITH region_mapping("oldSlug", "newSlug") AS (
  VALUES
    ('ramsey', 'iom-north'),
    ('castletown', 'iom-south'),
    ('port-erin', 'iom-south'),
    ('port-st-mary', 'iom-south'),
    ('ballasalla', 'iom-south'),
    ('douglas', 'iom-east'),
    ('onchan', 'iom-east'),
    ('laxey', 'iom-east'),
    ('peel', 'iom-west'),
    ('kirk-michael', 'iom-west'),
    ('isle-of-man', 'iom-central')
)
UPDATE "User" AS app_user
SET "regionId" = target_region."id"
FROM
  region_mapping,
  "Region" AS source_region,
  "Region" AS target_region
WHERE
  source_region."slug" = region_mapping."oldSlug"
  AND target_region."slug" = region_mapping."newSlug"
  AND app_user."regionId" = source_region."id";

UPDATE "SavedSearch"
SET
  "queryParamsJson" = jsonb_set(
    "queryParamsJson",
    '{region}',
    to_jsonb((
      CASE "queryParamsJson"->>'region'
        WHEN 'ramsey' THEN 'iom-north'
        WHEN 'castletown' THEN 'iom-south'
        WHEN 'port-erin' THEN 'iom-south'
        WHEN 'port-st-mary' THEN 'iom-south'
        WHEN 'ballasalla' THEN 'iom-south'
        WHEN 'douglas' THEN 'iom-east'
        WHEN 'onchan' THEN 'iom-east'
        WHEN 'laxey' THEN 'iom-east'
        WHEN 'peel' THEN 'iom-west'
        WHEN 'kirk-michael' THEN 'iom-west'
        WHEN 'isle-of-man' THEN 'iom-central'
      END
    )::text),
    false
  ),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "queryParamsJson"->>'region' IN (
  'ramsey',
  'castletown',
  'port-erin',
  'port-st-mary',
  'ballasalla',
  'douglas',
  'onchan',
  'laxey',
  'peel',
  'kirk-michael',
  'isle-of-man'
);

DELETE FROM "Region"
WHERE "slug" IN (
  'ramsey',
  'castletown',
  'port-erin',
  'port-st-mary',
  'ballasalla',
  'douglas',
  'onchan',
  'laxey',
  'peel',
  'kirk-michael',
  'isle-of-man'
);

UPDATE "Region"
SET "active" = false
WHERE "slug" NOT IN (
  'iom-north',
  'iom-south',
  'iom-east',
  'iom-west',
  'iom-central',
  'uk'
);

CREATE INDEX IF NOT EXISTS "Region_active_sortOrder_idx"
ON "Region"("active", "sortOrder");

COMMIT;
