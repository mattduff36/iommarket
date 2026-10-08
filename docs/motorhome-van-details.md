# Motorhome and van listing details

Optional fields for the Motorhomes (`motorhome`) and Vans (`van`) categories. They use the existing per-category `AttributeDefinition` rows. Cars and motorbikes are unchanged. No new tables.

Sleeping layout stores one primary value. Attribute values are a single string per definition, and public pages, revisions, and search render that string directly, so a multi-value encoding is not used.

`Unknown` is a stored answer. It is not converted to `No`. Public specifications for motorhomes and vans omit blank values, `Unknown`, and `Not checked/Unknown`, then group the remaining values. Cars, motorbikes, and other categories keep their stored specification list, including blank and Unknown values, in the original order. Seller revisions and admin diffs still show `Unknown`, so a change from Unknown to No stays visible.

Weight and towing fields are seller-stated kilograms. They do not calculate payload and do not assess licence entitlement. Overall width excludes mirrors. A manufacturer size code such as `L2H2` is stored as text and is not turned into dimensions. The leisure battery is separate from the traction or starter battery. Base vehicle make and model are separate from the motorhome manufacturer and model.

## Bounds

Numeric limits are input guards. Dates must be real `YYYY-MM-DD` values from `1970-01-01` through the following UTC/local day, which only covers timezone differences. Text limits are 80 characters for names and heating type, 20 for a size code, and 400 for reported-issues notes.

| Slug | Category | Type | Options or bounds |
| --- | --- | --- | --- |
| body-type | motorhome | select | Campervan/van conversion, Low-profile coachbuilt, Overcab coachbuilt, A-class, Other. Label: Motorhome type. |
| sleeping-berths | motorhome | number | 0–16 |
| belted-travelling-seats | motorhome | number | 0–16. Separate from seats. |
| sleeping-layout | motorhome | select | Fixed double, Island bed, Fixed twin/singles, Bunk beds, Drop-down bed, Overcab bed, Convertible lounge, Other |
| main-layout | motorhome | select | Rear lounge, Rear bedroom, Rear kitchen, Rear washroom, Other |
| overall-length-m | both | number | 0.5–20, step 0.01 |
| overall-width-m | both | number | 0.5–20, step 0.01. Excludes mirrors. |
| overall-height-m | both | number | 0.5–20, step 0.01 |
| mtplm-kg | motorhome | number | 1–50000 |
| mro-kg | motorhome | number | 1–50000 |
| stated-payload-kg | motorhome | number | 0–50000 |
| base-vehicle-make | motorhome | text | 80 |
| base-vehicle-model | motorhome | text | 80 |
| last-habitation-check | motorhome | date | 1970-01-01 through the date cushion |
| last-damp-check | motorhome | date | same |
| damp-result | motorhome | select | No issues reported, Issues reported, Not checked/Unknown |
| reported-issues-notes | motorhome | text | 400. Seller-reported wording. |
| toilet, shower, heating, solar, leisure-battery, awning, rear-garage | motorhome | select | Yes, No, Unknown |
| heating-type | motorhome | text | 80, only when heating is Yes |
| solar-output-w | motorhome | number | 1–10000, only when solar is Yes |
| leisure-battery-ah | motorhome | number | 1–5000, only when leisure battery is Yes |
| fresh-water-litres, waste-water-litres | motorhome | number | 0–2000 |
| body-type | van | select | Panel van, Crew van/double cab, Minibus, Pickup, Dropside, Tipper, Luton/box van, Chassis cab, Refrigerated van, Other |
| wheelbase | van | select | Short, Medium, Long, Extra-long, Unknown |
| roof-height | van | select | Low, Medium, High, Extra-high, Unknown |
| manufacturer-size-designation | van | text | 20. Pattern: letters, numbers, spaces, `/`, `-`. |
| load-length-m, load-width-m, load-height-m, width-between-wheel-arches-m | van | number | 0.5–20, step 0.01 |
| load-volume-m3 | van | number | 0.1–200, step 0.01 |
| gvw-kg | van | number | 1–50000 |
| payload-kg, braked-towing-kg, unbraked-towing-kg | van | number | 0–50000. Braked and unbraked are separate. |
| sliding-doors | van | select | None, Left, Right, Both sides, Unknown |
| rear-doors | van | select | Barn doors, Tailgate, Other, Unknown |
| bulkhead, load-lining, racking, tie-downs, security-locks, tail-lift | van | select | Yes, No, Unknown |
| tail-lift-capacity-kg | van | number | 1–50000, only when tail lift is Yes |

Car body types stay Hatchback, Saloon, SUV, Estate, Coupe, Convertible, MPV, Pickup. A stored body type that is no longer in the category list can be kept or cleared. A different value that is not in the current list is rejected. Nothing is remapped.

Empty optional fields are omitted on save. Create, draft update, and pending revision replace the saved attribute rows, so a cleared field is removed. Switching category drops attributes that do not belong to the new category.

## Staging migration

File: `prisma/migrations/20261008160000_motorhome_van_details/migration.sql`.

Order:

1. Deploy this application build to staging first. The migration changes body-type options. An older build can reject a legacy body type on edit.
2. Confirm the target is the staging database, never production.
3. Confirm `Category.slug` rows `van` and `motorhome` already exist. A missing category is skipped; the migration does not create categories.
4. Apply only that SQL file. It updates body-type name/options by slug, inserts missing detail definitions with deterministic ids, then refreshes those detail rows by slug. Existing definition ids are left in place. It does not update or delete `ListingAttributeValue` or `ListingRevisionAttributeValue`.
5. Re-running the file is safe.
6. Check:

```sql
SELECT c.slug, a.slug, a.id, a.name, a."dataType", a.required, a.options
FROM "AttributeDefinition" a
JOIN "Category" c ON c.id = a."categoryId"
WHERE c.slug IN ('van', 'motorhome')
ORDER BY c.slug, a."sortOrder";
```

`npm run` is not wired to this script. Check the file without a database connection:

```bash
npx tsx scripts/motorhome-van-details.ts
```

The script exits if asked to apply. It does not open a database connection.

Seed upserts use the same definitions, so a fresh database seeded with this code matches the migration. Do not run seed against production to apply this change.

## Rollback

Do not delete definitions that already have listing or revision values. Those foreign keys cascade and would remove seller data.

1. Restore body-type options. Motorhome name goes back to `Body Type`. Van and motorhome options go back to the car list: `["Hatchback","Saloon","SUV","Estate","Coupe","Convertible","MPV","Pickup"]`.
2. Leave detail definitions in place if any values exist. The previous application shows unknown slugs as ordinary optional fields.
3. Only when a detail definition has no `ListingAttributeValue` and no `ListingRevisionAttributeValue` rows is it safe to delete that definition by category slug and attribute slug.
