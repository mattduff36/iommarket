-- Optional motorhome and van listing details.
-- Repeatable. Categories and attributes are matched by slug.
-- Existing AttributeDefinition ids are preserved.
-- Stored listing and revision answers are not modified.
-- 52 new optional attribute rows: sleeping-berths, belted-travelling-seats, sleeping-layout, main-layout, overall-length-m, overall-width-m, overall-height-m, mtplm-kg, mro-kg, stated-payload-kg, base-vehicle-make, base-vehicle-model, last-habitation-check, last-damp-check, damp-result, reported-issues-notes, toilet, shower, heating, heating-type, solar, solar-output-w, leisure-battery, leisure-battery-ah, fresh-water-litres, waste-water-litres, awning, rear-garage, wheelbase, roof-height, manufacturer-size-designation, overall-length-m, overall-width-m, overall-height-m, load-length-m, load-width-m, load-height-m, width-between-wheel-arches-m, load-volume-m3, gvw-kg, payload-kg, braked-towing-kg, unbraked-towing-kg, sliding-doors, rear-doors, bulkhead, load-lining, racking, tie-downs, security-locks, tail-lift, tail-lift-capacity-kg

UPDATE "AttributeDefinition" AS attribute
SET
  name = 'Motorhome type',
  options = '["Campervan/van conversion","Low-profile coachbuilt","Overcab coachbuilt","A-class","Other"]'
FROM "Category" AS category
WHERE attribute."categoryId" = category.id
  AND category.slug = 'motorhome'
  AND attribute.slug = 'body-type';

UPDATE "AttributeDefinition" AS attribute
SET
  name = 'Body Type',
  options = '["Panel van","Crew van/double cab","Minibus","Pickup","Dropside","Tipper","Luton/box van","Chassis cab","Refrigerated van","Other"]'
FROM "Category" AS category
WHERE attribute."categoryId" = category.id
  AND category.slug = 'van'
  AND attribute.slug = 'body-type';

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
  src.id,
  category.id,
  src.name,
  src.slug,
  src.data_type,
  src.required,
  src.options,
  src.sort_order
FROM "Category" AS category
JOIN (
  VALUES
    ('mh_sleeping-berths', 'motorhome', 'Sleeping berths', 'sleeping-berths', 'number', FALSE, NULL::text, 40),
    ('mh_belted-travelling-seats', 'motorhome', 'Belted travelling seats', 'belted-travelling-seats', 'number', FALSE, NULL::text, 41),
    ('mh_sleeping-layout', 'motorhome', 'Sleeping layout', 'sleeping-layout', 'select', FALSE, '["Fixed double","Island bed","Fixed twin/singles","Bunk beds","Drop-down bed","Overcab bed","Convertible lounge","Other"]', 42),
    ('mh_main-layout', 'motorhome', 'Main layout', 'main-layout', 'select', FALSE, '["Rear lounge","Rear bedroom","Rear kitchen","Rear washroom","Other"]', 43),
    ('mh_overall-length-m', 'motorhome', 'Overall length (m)', 'overall-length-m', 'number', FALSE, NULL::text, 50),
    ('mh_overall-width-m', 'motorhome', 'Overall width excluding mirrors (m)', 'overall-width-m', 'number', FALSE, NULL::text, 51),
    ('mh_overall-height-m', 'motorhome', 'Overall height (m)', 'overall-height-m', 'number', FALSE, NULL::text, 52),
    ('mh_mtplm-kg', 'motorhome', 'Maximum laden weight MTPLM/MAM (kg)', 'mtplm-kg', 'number', FALSE, NULL::text, 53),
    ('mh_mro-kg', 'motorhome', 'Mass in running order MRO (kg)', 'mro-kg', 'number', FALSE, NULL::text, 54),
    ('mh_stated-payload-kg', 'motorhome', 'Stated payload (kg)', 'stated-payload-kg', 'number', FALSE, NULL::text, 55),
    ('mh_base-vehicle-make', 'motorhome', 'Base vehicle make', 'base-vehicle-make', 'text', FALSE, NULL::text, 60),
    ('mh_base-vehicle-model', 'motorhome', 'Base vehicle model', 'base-vehicle-model', 'text', FALSE, NULL::text, 61),
    ('mh_last-habitation-check', 'motorhome', 'Last habitation check', 'last-habitation-check', 'date', FALSE, NULL::text, 62),
    ('mh_last-damp-check', 'motorhome', 'Last damp check', 'last-damp-check', 'date', FALSE, NULL::text, 63),
    ('mh_damp-result', 'motorhome', 'Damp check result', 'damp-result', 'select', FALSE, '["No issues reported","Issues reported","Not checked/Unknown"]', 64),
    ('mh_reported-issues-notes', 'motorhome', 'Reported issues notes', 'reported-issues-notes', 'text', FALSE, NULL::text, 65),
    ('mh_toilet', 'motorhome', 'Toilet', 'toilet', 'select', FALSE, '["Yes","No","Unknown"]', 70),
    ('mh_shower', 'motorhome', 'Shower', 'shower', 'select', FALSE, '["Yes","No","Unknown"]', 71),
    ('mh_heating', 'motorhome', 'Heating', 'heating', 'select', FALSE, '["Yes","No","Unknown"]', 72),
    ('mh_heating-type', 'motorhome', 'Heating type', 'heating-type', 'text', FALSE, NULL::text, 73),
    ('mh_solar', 'motorhome', 'Solar', 'solar', 'select', FALSE, '["Yes","No","Unknown"]', 74),
    ('mh_solar-output-w', 'motorhome', 'Solar output (W)', 'solar-output-w', 'number', FALSE, NULL::text, 75),
    ('mh_leisure-battery', 'motorhome', 'Leisure battery', 'leisure-battery', 'select', FALSE, '["Yes","No","Unknown"]', 76),
    ('mh_leisure-battery-ah', 'motorhome', 'Leisure battery capacity (Ah)', 'leisure-battery-ah', 'number', FALSE, NULL::text, 77),
    ('mh_fresh-water-litres', 'motorhome', 'Fresh water (litres)', 'fresh-water-litres', 'number', FALSE, NULL::text, 78),
    ('mh_waste-water-litres', 'motorhome', 'Waste water (litres)', 'waste-water-litres', 'number', FALSE, NULL::text, 79),
    ('mh_awning', 'motorhome', 'Awning', 'awning', 'select', FALSE, '["Yes","No","Unknown"]', 80),
    ('mh_rear-garage', 'motorhome', 'Rear garage or storage', 'rear-garage', 'select', FALSE, '["Yes","No","Unknown"]', 81),
    ('van_wheelbase', 'van', 'Wheelbase', 'wheelbase', 'select', FALSE, '["Short","Medium","Long","Extra-long","Unknown"]', 40),
    ('van_roof-height', 'van', 'Roof height', 'roof-height', 'select', FALSE, '["Low","Medium","High","Extra-high","Unknown"]', 41),
    ('van_manufacturer-size-designation', 'van', 'Manufacturer size designation', 'manufacturer-size-designation', 'text', FALSE, NULL::text, 42),
    ('van_overall-length-m', 'van', 'Overall length (m)', 'overall-length-m', 'number', FALSE, NULL::text, 50),
    ('van_overall-width-m', 'van', 'Overall width excluding mirrors (m)', 'overall-width-m', 'number', FALSE, NULL::text, 51),
    ('van_overall-height-m', 'van', 'Overall height (m)', 'overall-height-m', 'number', FALSE, NULL::text, 52),
    ('van_load-length-m', 'van', 'Load space length (m)', 'load-length-m', 'number', FALSE, NULL::text, 53),
    ('van_load-width-m', 'van', 'Load space width (m)', 'load-width-m', 'number', FALSE, NULL::text, 54),
    ('van_load-height-m', 'van', 'Load space height (m)', 'load-height-m', 'number', FALSE, NULL::text, 55),
    ('van_width-between-wheel-arches-m', 'van', 'Width between wheel arches (m)', 'width-between-wheel-arches-m', 'number', FALSE, NULL::text, 56),
    ('van_load-volume-m3', 'van', 'Load volume (m3)', 'load-volume-m3', 'number', FALSE, NULL::text, 57),
    ('van_gvw-kg', 'van', 'Gross vehicle weight (kg)', 'gvw-kg', 'number', FALSE, NULL::text, 60),
    ('van_payload-kg', 'van', 'Payload (kg)', 'payload-kg', 'number', FALSE, NULL::text, 61),
    ('van_braked-towing-kg', 'van', 'Braked towing capacity (kg)', 'braked-towing-kg', 'number', FALSE, NULL::text, 62),
    ('van_unbraked-towing-kg', 'van', 'Unbraked towing capacity (kg)', 'unbraked-towing-kg', 'number', FALSE, NULL::text, 63),
    ('van_sliding-doors', 'van', 'Sliding doors', 'sliding-doors', 'select', FALSE, '["None","Left","Right","Both sides","Unknown"]', 70),
    ('van_rear-doors', 'van', 'Rear doors', 'rear-doors', 'select', FALSE, '["Barn doors","Tailgate","Other","Unknown"]', 71),
    ('van_bulkhead', 'van', 'Bulkhead', 'bulkhead', 'select', FALSE, '["Yes","No","Unknown"]', 72),
    ('van_load-lining', 'van', 'Load lining', 'load-lining', 'select', FALSE, '["Yes","No","Unknown"]', 73),
    ('van_racking', 'van', 'Racking', 'racking', 'select', FALSE, '["Yes","No","Unknown"]', 74),
    ('van_tie-downs', 'van', 'Tie-downs', 'tie-downs', 'select', FALSE, '["Yes","No","Unknown"]', 75),
    ('van_security-locks', 'van', 'Security locks', 'security-locks', 'select', FALSE, '["Yes","No","Unknown"]', 76),
    ('van_tail-lift', 'van', 'Tail lift', 'tail-lift', 'select', FALSE, '["Yes","No","Unknown"]', 77),
    ('van_tail-lift-capacity-kg', 'van', 'Tail lift capacity (kg)', 'tail-lift-capacity-kg', 'number', FALSE, NULL::text, 78)
) AS src(id, category_slug, name, slug, data_type, required, options, sort_order)
  ON src.category_slug = category.slug
WHERE NOT EXISTS (
  SELECT 1
  FROM "AttributeDefinition" AS existing
  WHERE existing."categoryId" = category.id
    AND existing.slug = src.slug
);

UPDATE "AttributeDefinition" AS attribute
SET
  name = src.name,
  "dataType" = src.data_type,
  required = src.required,
  options = src.options,
  "sortOrder" = src.sort_order
FROM "Category" AS category
JOIN (
  VALUES
    ('mh_sleeping-berths', 'motorhome', 'Sleeping berths', 'sleeping-berths', 'number', FALSE, NULL::text, 40),
    ('mh_belted-travelling-seats', 'motorhome', 'Belted travelling seats', 'belted-travelling-seats', 'number', FALSE, NULL::text, 41),
    ('mh_sleeping-layout', 'motorhome', 'Sleeping layout', 'sleeping-layout', 'select', FALSE, '["Fixed double","Island bed","Fixed twin/singles","Bunk beds","Drop-down bed","Overcab bed","Convertible lounge","Other"]', 42),
    ('mh_main-layout', 'motorhome', 'Main layout', 'main-layout', 'select', FALSE, '["Rear lounge","Rear bedroom","Rear kitchen","Rear washroom","Other"]', 43),
    ('mh_overall-length-m', 'motorhome', 'Overall length (m)', 'overall-length-m', 'number', FALSE, NULL::text, 50),
    ('mh_overall-width-m', 'motorhome', 'Overall width excluding mirrors (m)', 'overall-width-m', 'number', FALSE, NULL::text, 51),
    ('mh_overall-height-m', 'motorhome', 'Overall height (m)', 'overall-height-m', 'number', FALSE, NULL::text, 52),
    ('mh_mtplm-kg', 'motorhome', 'Maximum laden weight MTPLM/MAM (kg)', 'mtplm-kg', 'number', FALSE, NULL::text, 53),
    ('mh_mro-kg', 'motorhome', 'Mass in running order MRO (kg)', 'mro-kg', 'number', FALSE, NULL::text, 54),
    ('mh_stated-payload-kg', 'motorhome', 'Stated payload (kg)', 'stated-payload-kg', 'number', FALSE, NULL::text, 55),
    ('mh_base-vehicle-make', 'motorhome', 'Base vehicle make', 'base-vehicle-make', 'text', FALSE, NULL::text, 60),
    ('mh_base-vehicle-model', 'motorhome', 'Base vehicle model', 'base-vehicle-model', 'text', FALSE, NULL::text, 61),
    ('mh_last-habitation-check', 'motorhome', 'Last habitation check', 'last-habitation-check', 'date', FALSE, NULL::text, 62),
    ('mh_last-damp-check', 'motorhome', 'Last damp check', 'last-damp-check', 'date', FALSE, NULL::text, 63),
    ('mh_damp-result', 'motorhome', 'Damp check result', 'damp-result', 'select', FALSE, '["No issues reported","Issues reported","Not checked/Unknown"]', 64),
    ('mh_reported-issues-notes', 'motorhome', 'Reported issues notes', 'reported-issues-notes', 'text', FALSE, NULL::text, 65),
    ('mh_toilet', 'motorhome', 'Toilet', 'toilet', 'select', FALSE, '["Yes","No","Unknown"]', 70),
    ('mh_shower', 'motorhome', 'Shower', 'shower', 'select', FALSE, '["Yes","No","Unknown"]', 71),
    ('mh_heating', 'motorhome', 'Heating', 'heating', 'select', FALSE, '["Yes","No","Unknown"]', 72),
    ('mh_heating-type', 'motorhome', 'Heating type', 'heating-type', 'text', FALSE, NULL::text, 73),
    ('mh_solar', 'motorhome', 'Solar', 'solar', 'select', FALSE, '["Yes","No","Unknown"]', 74),
    ('mh_solar-output-w', 'motorhome', 'Solar output (W)', 'solar-output-w', 'number', FALSE, NULL::text, 75),
    ('mh_leisure-battery', 'motorhome', 'Leisure battery', 'leisure-battery', 'select', FALSE, '["Yes","No","Unknown"]', 76),
    ('mh_leisure-battery-ah', 'motorhome', 'Leisure battery capacity (Ah)', 'leisure-battery-ah', 'number', FALSE, NULL::text, 77),
    ('mh_fresh-water-litres', 'motorhome', 'Fresh water (litres)', 'fresh-water-litres', 'number', FALSE, NULL::text, 78),
    ('mh_waste-water-litres', 'motorhome', 'Waste water (litres)', 'waste-water-litres', 'number', FALSE, NULL::text, 79),
    ('mh_awning', 'motorhome', 'Awning', 'awning', 'select', FALSE, '["Yes","No","Unknown"]', 80),
    ('mh_rear-garage', 'motorhome', 'Rear garage or storage', 'rear-garage', 'select', FALSE, '["Yes","No","Unknown"]', 81),
    ('van_wheelbase', 'van', 'Wheelbase', 'wheelbase', 'select', FALSE, '["Short","Medium","Long","Extra-long","Unknown"]', 40),
    ('van_roof-height', 'van', 'Roof height', 'roof-height', 'select', FALSE, '["Low","Medium","High","Extra-high","Unknown"]', 41),
    ('van_manufacturer-size-designation', 'van', 'Manufacturer size designation', 'manufacturer-size-designation', 'text', FALSE, NULL::text, 42),
    ('van_overall-length-m', 'van', 'Overall length (m)', 'overall-length-m', 'number', FALSE, NULL::text, 50),
    ('van_overall-width-m', 'van', 'Overall width excluding mirrors (m)', 'overall-width-m', 'number', FALSE, NULL::text, 51),
    ('van_overall-height-m', 'van', 'Overall height (m)', 'overall-height-m', 'number', FALSE, NULL::text, 52),
    ('van_load-length-m', 'van', 'Load space length (m)', 'load-length-m', 'number', FALSE, NULL::text, 53),
    ('van_load-width-m', 'van', 'Load space width (m)', 'load-width-m', 'number', FALSE, NULL::text, 54),
    ('van_load-height-m', 'van', 'Load space height (m)', 'load-height-m', 'number', FALSE, NULL::text, 55),
    ('van_width-between-wheel-arches-m', 'van', 'Width between wheel arches (m)', 'width-between-wheel-arches-m', 'number', FALSE, NULL::text, 56),
    ('van_load-volume-m3', 'van', 'Load volume (m3)', 'load-volume-m3', 'number', FALSE, NULL::text, 57),
    ('van_gvw-kg', 'van', 'Gross vehicle weight (kg)', 'gvw-kg', 'number', FALSE, NULL::text, 60),
    ('van_payload-kg', 'van', 'Payload (kg)', 'payload-kg', 'number', FALSE, NULL::text, 61),
    ('van_braked-towing-kg', 'van', 'Braked towing capacity (kg)', 'braked-towing-kg', 'number', FALSE, NULL::text, 62),
    ('van_unbraked-towing-kg', 'van', 'Unbraked towing capacity (kg)', 'unbraked-towing-kg', 'number', FALSE, NULL::text, 63),
    ('van_sliding-doors', 'van', 'Sliding doors', 'sliding-doors', 'select', FALSE, '["None","Left","Right","Both sides","Unknown"]', 70),
    ('van_rear-doors', 'van', 'Rear doors', 'rear-doors', 'select', FALSE, '["Barn doors","Tailgate","Other","Unknown"]', 71),
    ('van_bulkhead', 'van', 'Bulkhead', 'bulkhead', 'select', FALSE, '["Yes","No","Unknown"]', 72),
    ('van_load-lining', 'van', 'Load lining', 'load-lining', 'select', FALSE, '["Yes","No","Unknown"]', 73),
    ('van_racking', 'van', 'Racking', 'racking', 'select', FALSE, '["Yes","No","Unknown"]', 74),
    ('van_tie-downs', 'van', 'Tie-downs', 'tie-downs', 'select', FALSE, '["Yes","No","Unknown"]', 75),
    ('van_security-locks', 'van', 'Security locks', 'security-locks', 'select', FALSE, '["Yes","No","Unknown"]', 76),
    ('van_tail-lift', 'van', 'Tail lift', 'tail-lift', 'select', FALSE, '["Yes","No","Unknown"]', 77),
    ('van_tail-lift-capacity-kg', 'van', 'Tail lift capacity (kg)', 'tail-lift-capacity-kg', 'number', FALSE, NULL::text, 78)
) AS src(id, category_slug, name, slug, data_type, required, options, sort_order)
  ON src.category_slug = category.slug
WHERE attribute."categoryId" = category.id
  AND attribute.slug = src.slug;
