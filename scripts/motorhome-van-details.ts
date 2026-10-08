import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { attributeDefsForCategory } from "../prisma/seed/catalog-attributes";
import { renderMotorhomeVanDetailsMigrationSql } from "../lib/listings/vehicle-detail-migration-sql";
import {
  bodyTypePresentation,
  vehicleDetailAttributes,
} from "../lib/listings/vehicle-detail-catalog";

const MIGRATION = resolve(
  process.cwd(),
  "prisma/migrations/20261008160000_motorhome_van_details/migration.sql",
);

function inventoryLine(categorySlug: "motorhome" | "van") {
  return vehicleDetailAttributes(categorySlug)
    .map((attribute) => {
      const bounds = [
        attribute.dataType,
        attribute.options ? attribute.options.join(" | ") : null,
        attribute.min !== undefined ? `min ${attribute.min}` : null,
        attribute.max !== undefined ? `max ${attribute.max}` : null,
        attribute.step !== undefined ? `step ${attribute.step}` : null,
        attribute.maxLength ? `maxLength ${attribute.maxLength}` : null,
        attribute.showWhen ? `when ${attribute.showWhen.slug}=Yes` : null,
        attribute.group,
      ].filter(Boolean);
      return `  ${attribute.slug}: ${bounds.join(", ")}`;
    })
    .join("\n");
}

function main() {
  if (process.argv.includes("--apply") || process.argv.includes("--execute")) {
    console.error("Refusing to apply. This script does not connect to a database.");
    process.exit(1);
  }

  const sql = readFileSync(MIGRATION, "utf8");
  if (sql !== renderMotorhomeVanDetailsMigrationSql()) {
    console.error("Migration SQL is out of date with the detail catalog.");
    process.exit(1);
  }

  for (const categorySlug of ["motorhome", "van"] as const) {
    const presentation = bodyTypePresentation(categorySlug);
    const slugs = new Set(attributeDefsForCategory(categorySlug).map((attribute) => attribute.slug));
    for (const attribute of vehicleDetailAttributes(categorySlug)) {
      if (!slugs.has(attribute.slug) || attributeDefsForCategory(categorySlug).find((item) => item.slug === attribute.slug)?.required) {
        console.error(`Seed definition missing or required: ${categorySlug}/${attribute.slug}`);
        process.exit(1);
      }
    }
    console.log(`${categorySlug} body-type: ${presentation?.name} = ${presentation?.options.join(" | ")}`);
    console.log(inventoryLine(categorySlug));
  }

  console.log(`
Staging apply (no production writes):
1. Deploy this build to staging before applying the SQL. An older build rejects legacy body types once options change.
2. Confirm the database is staging, and that Category rows exist for slugs van and motorhome.
3. Apply only prisma/migrations/20261008160000_motorhome_van_details/migration.sql
   Example: psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261008160000_motorhome_van_details/migration.sql
4. Check:
   SELECT c.slug, a.slug, a.name, a."dataType", a.required, a.options
   FROM "AttributeDefinition" a
   JOIN "Category" c ON c.id = a."categoryId"
   WHERE c.slug IN ('van', 'motorhome')
   ORDER BY c.slug, a."sortOrder";
5. Confirm the statement did not update ListingAttributeValue. Re-running the file is safe.

Rollback considerations are in docs/motorhome-van-details.md. Do not delete definitions that already store values.
`);
}

main();
