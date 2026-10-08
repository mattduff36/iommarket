import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collectListingAttributes } from "@/app/(public)/sell/create-listing-submit";
import {
  getAttributeFieldConfig,
  validateListingAttributes,
} from "@/lib/listings/attribute-ui";
import { buildRevisionFieldDiffs } from "@/lib/listings/revision-preview";
import { renderMotorhomeVanDetailsMigrationSql } from "@/lib/listings/vehicle-detail-migration-sql";
import {
  groupPublicSpecifications,
  MOTORHOME_BODY_TYPES,
  VAN_BODY_TYPES,
} from "@/lib/listings/vehicle-detail-catalog";
import {
  attributeDefsForCategory,
  carBodyTypeOptions,
} from "@/prisma/seed/catalog-attributes";
import { listingDetailsSchema } from "@/lib/validations/listing";

const MIGRATION = resolve(
  process.cwd(),
  "prisma/migrations/20261008160000_motorhome_van_details/migration.sql",
);

function definition(category: "motorhome" | "van" | "car", slug: string) {
  const seed = attributeDefsForCategory(category).find((attribute) => attribute.slug === slug);
  if (!seed) throw new Error(`Missing ${category}/${slug}`);
  return { id: `${category}_${slug}`, ...seed };
}

describe("motorhome and van detail attributes", () => {
  it("keeps every new field optional and accepts non-CUID ids", () => {
    const sleeping = definition("motorhome", "sleeping-berths");
    const toilet = definition("motorhome", "toilet");
    expect(sleeping.id).toBe("motorhome_sleeping-berths");
    expect(sleeping.required).toBe(false);

    const empty = validateListingAttributes({
      categorySlug: "motorhome",
      definitions: [sleeping, toilet],
      attributes: [],
    });
    expect(empty.fieldErrors).toEqual({});
    expect(empty.sanitizedAttributes).toEqual([]);

    const parsed = listingDetailsSchema.safeParse({
      title: "Swift Kon-Tiki 649",
      description: "A motorhome listed with optional habitation details.",
      price: 5_499_500,
      categoryId: "motorhome_a96c2e2c9bc030d3e6d3",
      regionId: "clregion123456789012345678",
      trustDeclarationAccepted: true,
      attributes: [{ attributeDefinitionId: sleeping.id, value: "4" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts bounded decimals and rejects malformed, negative, and excessive numbers", () => {
    const length = definition("motorhome", "overall-length-m");
    const accepted = validateListingAttributes({
      categorySlug: "motorhome",
      definitions: [length],
      attributes: [{ attributeDefinitionId: length.id, value: "7.25" }],
    });
    expect(accepted.sanitizedAttributes).toEqual([
      { attributeDefinitionId: length.id, value: "7.25" },
    ]);

    for (const value of ["-1", "7.256", "1e2", "99", "abc"]) {
      const rejected = validateListingAttributes({
        categorySlug: "motorhome",
        definitions: [length],
        attributes: [{ attributeDefinitionId: length.id, value }],
      });
      expect(rejected.fieldErrors[`attr-${length.id}`]?.length).toBe(1);
    }
  });

  it("stores Unknown and No as different answers", () => {
    const toilet = definition("motorhome", "toilet");
    for (const value of ["Unknown", "No", "Yes"]) {
      const result = validateListingAttributes({
        categorySlug: "motorhome",
        definitions: [toilet],
        attributes: [{ attributeDefinitionId: toilet.id, value }],
      });
      expect(result.sanitizedAttributes).toEqual([
        { attributeDefinitionId: toilet.id, value },
      ]);
    }

    const coerced = validateListingAttributes({
      categorySlug: "motorhome",
      definitions: [toilet],
      attributes: [{ attributeDefinitionId: toilet.id, value: "false" }],
    });
    expect(coerced.sanitizedAttributes).toEqual([]);
    expect(getAttributeFieldConfig("motorhome", toilet, undefined)?.control).toBe("select");
  });

  it("hides and rejects dependent fields unless the parent is Yes", () => {
    const heating = definition("motorhome", "heating");
    const heatingType = definition("motorhome", "heating-type");
    const hidden = getAttributeFieldConfig("motorhome", heatingType, undefined, {
      valuesBySlug: { heating: "No" },
    });
    expect(hidden).toBeNull();
    expect(
      getAttributeFieldConfig("motorhome", heatingType, undefined, {
        valuesBySlug: { heating: "Yes" },
      })?.control,
    ).toBe("text");

    const rejected = validateListingAttributes({
      categorySlug: "motorhome",
      definitions: [heating, heatingType],
      attributes: [
        { attributeDefinitionId: heating.id, value: "Unknown" },
        { attributeDefinitionId: heatingType.id, value: "Gas" },
      ],
    });
    expect(rejected.fieldErrors[`attr-${heatingType.id}`]?.[0]).toContain("Heating is Yes");
    expect(rejected.sanitizedAttributes).toEqual([
      { attributeDefinitionId: heating.id, value: "Unknown" },
    ]);

    const tailLift = definition("van", "tail-lift");
    const capacity = definition("van", "tail-lift-capacity-kg");
    const accepted = validateListingAttributes({
      categorySlug: "van",
      definitions: [tailLift, capacity],
      attributes: [
        { attributeDefinitionId: tailLift.id, value: "Yes" },
        { attributeDefinitionId: capacity.id, value: "500" },
      ],
    });
    expect(accepted.fieldErrors).toEqual({});
  });

  it("retains a legacy body type and rejects a different forged value", () => {
    const body = definition("motorhome", "body-type");
    expect(JSON.parse(body.options ?? "[]")).toEqual([...MOTORHOME_BODY_TYPES]);
    const retained = [{ attributeDefinitionId: body.id, value: "Hatchback" }];
    const config = getAttributeFieldConfig("motorhome", body, undefined, {
      retainedValue: "Hatchback",
    });
    expect(config?.options?.[0]).toBe("Hatchback");

    const kept = validateListingAttributes({
      categorySlug: "motorhome",
      definitions: [body],
      attributes: retained,
      retainedAttributes: retained,
    });
    expect(kept.sanitizedAttributes).toEqual(retained);

    const forged = validateListingAttributes({
      categorySlug: "motorhome",
      definitions: [body],
      attributes: [{ attributeDefinitionId: body.id, value: "Saloon" }],
      retainedAttributes: retained,
    });
    expect(forged.sanitizedAttributes).toEqual([]);

    const differentBody = validateListingAttributes({
      categorySlug: "motorhome",
      definitions: [body],
      attributes: [{ attributeDefinitionId: body.id, value: "Panel van" }],
      retainedAttributes: retained,
    });
    expect(differentBody.sanitizedAttributes).toEqual([]);

    const cleared = validateListingAttributes({
      categorySlug: "motorhome",
      definitions: [body],
      attributes: [],
      retainedAttributes: retained,
    });
    expect(cleared.sanitizedAttributes).toEqual([]);
  });

  it("does not retain invalid car transmission or write-off values", () => {
    const transmission = definition("car", "transmission");
    const writeOff = definition("car", "write-off-category");
    const carBody = definition("car", "body-type");

    expect(
      getAttributeFieldConfig("car", transmission, undefined, { retainedValue: "CVT" })?.options,
    ).toEqual(["Manual", "Automatic"]);
    expect(
      getAttributeFieldConfig("car", writeOff, undefined, { retainedValue: "Category A" })?.options,
    ).not.toContain("Category A");
    expect(
      getAttributeFieldConfig("car", carBody, undefined, { retainedValue: "Panel van" })?.options,
    ).not.toContain("Panel van");

    const rejected = validateListingAttributes({
      categorySlug: "car",
      definitions: [transmission, writeOff, carBody],
      attributes: [
        { attributeDefinitionId: transmission.id, value: "CVT" },
        { attributeDefinitionId: writeOff.id, value: "Category A" },
        { attributeDefinitionId: carBody.id, value: "Panel van" },
      ],
      retainedAttributes: [
        { attributeDefinitionId: transmission.id, value: "CVT" },
        { attributeDefinitionId: writeOff.id, value: "Category A" },
        { attributeDefinitionId: carBody.id, value: "Panel van" },
      ],
    });
    expect(rejected.sanitizedAttributes).toEqual([]);
    expect(rejected.fieldErrors[`attr-${transmission.id}`]?.[0]).toContain("transmission");
    expect(rejected.fieldErrors[`attr-${writeOff.id}`]?.[0]).toContain("write-off");
    expect(rejected.fieldErrors[`attr-${carBody.id}`]?.[0]).toContain("body type");
  });

  it("leaves car and motorbike definitions unchanged", () => {
    const carBody = attributeDefsForCategory("car").find((attribute) => attribute.slug === "body-type");
    expect(JSON.parse(carBody?.options ?? "[]")).toEqual(carBodyTypeOptions());
    expect(carBodyTypeOptions()).not.toContain("Panel van");
    expect(JSON.parse(definition("van", "body-type").options ?? "[]")).toEqual([...VAN_BODY_TYPES]);

    const motorbikeSlugs = attributeDefsForCategory("motorbike").map((attribute) => attribute.slug);
    expect(motorbikeSlugs).not.toContain("body-type");
    expect(motorbikeSlugs).not.toContain("sleeping-berths");
    expect(motorbikeSlugs).not.toContain("wheelbase");

    const carSlugs = attributeDefsForCategory("car").map((attribute) => attribute.slug);
    expect(carSlugs).not.toContain("sleeping-berths");
    expect(carSlugs).not.toContain("gvw-kg");
  });

  it("drops attributes from another category and blank optional values", () => {
    const sleeping = definition("motorhome", "sleeping-berths");
    const wheelbase = definition("van", "wheelbase");
    const result = validateListingAttributes({
      categorySlug: "van",
      definitions: [wheelbase],
      attributes: [
        { attributeDefinitionId: sleeping.id, value: "4" },
        { attributeDefinitionId: wheelbase.id, value: "Long" },
      ],
    });
    expect(result.sanitizedAttributes).toEqual([
      { attributeDefinitionId: wheelbase.id, value: "Long" },
    ]);

    expect(
      collectListingAttributes(
        [sleeping, wheelbase],
        { [sleeping.id]: " ", [wheelbase.id]: "Long" },
      ),
    ).toEqual([{ attributeDefinitionId: wheelbase.id, value: "Long" }]);
  });

  it("groups completed public values and omits blank and Unknown answers", () => {
    const groups = groupPublicSpecifications({
      categorySlug: "motorhome",
      attributes: [
        { slug: "make", name: "Make", value: "Swift", sortOrder: 1 },
        { slug: "toilet", name: "Toilet", value: "Unknown", sortOrder: 70 },
        { slug: "shower", name: "Shower", value: "No", sortOrder: 71 },
        { slug: "damp-result", name: "Damp check result", value: "Not checked/Unknown", sortOrder: 64 },
        { slug: "sleeping-berths", name: "Sleeping berths", value: "4", sortOrder: 40 },
        { slug: "reported-issues-notes", name: "Reported issues notes", value: "   ", sortOrder: 65 },
      ],
    });

    expect(groups.map((group) => group.title)).toEqual([null, "Habitation", "Facilities"]);
    expect(groups[0]?.items.map((item) => item.value)).toEqual(["Swift"]);
    expect(groups[1]?.items.map((item) => item.slug)).toEqual(["sleeping-berths"]);
    expect(groups[2]?.items.map((item) => item.value)).toEqual(["No"]);
  });

  it("keeps car and motorbike public specifications in stored order", () => {
    const stored = [
      { slug: "colour", name: "Colour", value: "Unknown", sortOrder: 8 },
      { slug: "make", name: "Make", value: "Ford", sortOrder: 1 },
      { slug: "notes", name: "Notes", value: "   ", sortOrder: 2 },
    ];

    for (const categorySlug of ["car", "motorbike"]) {
      const groups = groupPublicSpecifications({ categorySlug, attributes: stored });
      expect(groups).toEqual([{ id: "essentials", title: null, items: stored }]);
    }
  });

  it("keeps Unknown visible in a revision diff", () => {
    const diffs = buildRevisionFieldDiffs(
      {
        title: "Swift",
        description: "A motorhome with a full description.",
        price: 100,
        categoryName: "Motorhomes",
        regionName: "Douglas",
        attributes: [{ name: "Toilet", value: "Unknown" }],
        imagePublicIds: [],
      },
      {
        title: "Swift",
        description: "A motorhome with a full description.",
        price: 100,
        categoryName: "Motorhomes",
        regionName: "Douglas",
        attributes: [{ name: "Toilet", value: "No" }],
        imagePublicIds: [],
      },
    );
    expect(diffs).toContainEqual({ field: "Toilet", live: "Unknown", proposed: "No" });
  });

  it("prepares a repeatable migration that does not rewrite stored values", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toBe(renderMotorhomeVanDetailsMigrationSql());
    expect(sql).toContain("category.slug = 'motorhome'");
    expect(sql).toContain("category.slug = 'van'");
    expect(sql).not.toMatch(/ListingAttributeValue|ListingRevisionAttributeValue/);
    expect(sql).not.toMatch(/slug = 'car'/);
    expect(sql).not.toMatch(/\b(?:DELETE|TRUNCATE)\b/);
    for (const slug of ["sleeping-berths", "belted-travelling-seats", "wheelbase", "tail-lift-capacity-kg"]) {
      expect(sql).toContain(`'${slug}'`);
    }
  });
});
