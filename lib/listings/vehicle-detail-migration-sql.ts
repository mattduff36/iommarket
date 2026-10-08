import { attributeDefsForCategory } from "../../prisma/seed/catalog-attributes";
import { bodyTypePresentation, vehicleDetailAttributes } from "./vehicle-detail-catalog";

const MIGRATION_CATEGORIES = ["motorhome", "van"] as const;

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function valuesRows(categorySlug: (typeof MIGRATION_CATEGORIES)[number]): string {
  return vehicleDetailAttributes(categorySlug)
    .map((attribute) => {
      const id = `${categorySlug === "motorhome" ? "mh" : "van"}_${attribute.slug}`;
      const options = attribute.options
        ? sqlString(JSON.stringify(attribute.options))
        : "NULL::text";
      return `    (${sqlString(id)}, ${sqlString(categorySlug)}, ${sqlString(attribute.name)}, ${sqlString(attribute.slug)}, ${sqlString(attribute.dataType)}, FALSE, ${options}, ${attribute.sortOrder})`;
    })
    .join(",\n");
}

function bodyTypeUpdate(categorySlug: (typeof MIGRATION_CATEGORIES)[number]): string {
  const presentation = bodyTypePresentation(categorySlug);
  if (!presentation) return "";
  return `UPDATE "AttributeDefinition" AS attribute
SET
  name = ${sqlString(presentation.name)},
  options = ${sqlString(JSON.stringify(presentation.options))}
FROM "Category" AS category
WHERE attribute."categoryId" = category.id
  AND category.slug = ${sqlString(categorySlug)}
  AND attribute.slug = 'body-type';`;
}

/**
 * Repeatable category-data migration. Matches rows by category slug and
 * attribute slug, preserves existing definition ids, and does not write
 * listing or revision attribute values.
 */
export function renderMotorhomeVanDetailsMigrationSql(): string {
  const detailSlugs = MIGRATION_CATEGORIES.flatMap((categorySlug) =>
    attributeDefsForCategory(categorySlug)
      .filter((attribute) =>
        vehicleDetailAttributes(categorySlug).some((detail) => detail.slug === attribute.slug),
      )
      .map((attribute) => attribute.slug),
  );
  const values = MIGRATION_CATEGORIES.map(valuesRows).join(",\n");

  return `-- Optional motorhome and van listing details.
-- Repeatable. Categories and attributes are matched by slug.
-- Existing AttributeDefinition ids are preserved.
-- Stored listing and revision answers are not modified.
-- ${detailSlugs.length} new optional attribute rows: ${detailSlugs.join(", ")}

${MIGRATION_CATEGORIES.map(bodyTypeUpdate).join("\n\n")}

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
${values}
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
${values}
) AS src(id, category_slug, name, slug, data_type, required, options, sort_order)
  ON src.category_slug = category.slug
WHERE attribute."categoryId" = category.id
  AND attribute.slug = src.slug;
`;
}
