import { Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { combineMarketplaceListingWhere } from "@/lib/listings/marketplace";
import {
  NUMERIC_ATTRIBUTE_FILTER_LIMITS,
  STORED_DECIMAL_PATTERN,
  numericAttributeListingIdQuery,
  parseNumericAttributeBound,
  storedDecimalSql,
} from "@/lib/listings/numeric-attribute-search";
import pg from "pg";

function toPg(query: Prisma.Sql): { text: string; values: unknown[] } {
  let text = "";
  query.strings.forEach((part, index) => {
    text += part;
    if (index < query.values.length) text += `$${index + 1}`;
  });
  return { text, values: query.values };
}

describe("numeric attribute listing id query", () => {
  it("binds slug and bounds and reads Prisma model tables", () => {
    const query = numericAttributeListingIdQuery([
      { slug: "doors", min: 2, max: 5 },
      { slug: "seats", min: 4 },
    ]);
    const sql = query.strings.join(" ");

    expect(sql).toContain('FROM "Listing" l');
    expect(sql).toContain('FROM "ListingAttributeValue" lav');
    expect(sql).toContain('JOIN "AttributeDefinition" ad');
    expect(sql).toContain('lav."attributeDefinitionId"');
    expect(sql).toContain('lav."listingId"');
    expect(sql).toContain("BETWEEN CAST(");
    expect(sql).toContain("THEN btrim(");
    expect(sql).not.toMatch(/\bFROM listings\b/);
    expect(sql).not.toContain("listing_attribute_values");
    expect(sql).not.toContain("attribute_definitions");
    expect(sql).not.toContain("attribute_definition_id");
    expect(sql).not.toContain("listing_id");
    expect(sql).not.toContain("doors");
    expect(sql).not.toContain("999999999");
    expect(query.values).toEqual([
      "doors",
      STORED_DECIMAL_PATTERN,
      2,
      5,
      "seats",
      STORED_DECIMAL_PATTERN,
      4,
      999999999,
    ]);
  });

  it("strictly parses bounded decimal and integer URL inputs", () => {
    expect(parseNumericAttributeBound("1.6", "engine-size")).toBe(1.6);
    expect(parseNumericAttributeBound("10", "engine-size")).toBe(10);
    expect(parseNumericAttributeBound("8.25", "acceleration")).toBe(8.25);
    expect(parseNumericAttributeBound("7.5", "charging-time")).toBe(7.5);
    expect(parseNumericAttributeBound("1.666667", "charging-time")).toBe(1.666667);
    expect(parseNumericAttributeBound("3.9", "doors")).toBeUndefined();
    expect(parseNumericAttributeBound("3000", "engine-power")).toBe(3000);
    for (const value of ["", "1x", "1e2", "Infinity", "NaN", "-1", "1000000000000", ".", "1.1234567"]) {
      expect(parseNumericAttributeBound(value, "engine-size")).toBeUndefined();
    }
    expect(parseNumericAttributeBound("70.1", "engine-size")).toBeUndefined();
    expect(parseNumericAttributeBound("61", "acceleration")).toBeUndefined();
    expect(parseNumericAttributeBound("169", "charging-time")).toBeUndefined();
    expect(Number.isFinite(NUMERIC_ATTRIBUTE_FILTER_LIMITS["engine-size"].max)).toBe(true);
  });

  it("rejects unknown slugs, non-finite bounds, and unsafe integer bounds", () => {
    expect(() => numericAttributeListingIdQuery([{ slug: "unknown", min: 1 }])).toThrow(/bounds are invalid/);
    expect(() => numericAttributeListingIdQuery([{ slug: "engine-size", min: Number.POSITIVE_INFINITY }])).toThrow(/bounds are invalid/);
    expect(() => numericAttributeListingIdQuery([{ slug: "engine-size", max: Number.NaN }])).toThrow(/bounds are invalid/);
    expect(() => numericAttributeListingIdQuery([{ slug: "engine-size", max: 1e100 }])).toThrow(/bounds are invalid/);
    expect(() => numericAttributeListingIdQuery([{ slug: "engine-size", max: 1000000000 }])).toThrow(/bounds are invalid/);
    expect(() => numericAttributeListingIdQuery([{ slug: "doors", min: 1.5 }])).toThrow(/bounds are invalid/);
    expect(numericAttributeListingIdQuery([{ slug: "engine-size", max: 10.01 }])).toBeTruthy();
  });

  it("rejects an empty filter list", () => {
    expect(() => numericAttributeListingIdQuery([])).toThrow(/at least one filter/);
  });

  it("keeps attribute id matches behind the caller visibility filter", () => {
    const visibility = { status: "LIVE" as const };
    const where = combineMarketplaceListingWhere({
      visibility,
      filters: { id: { in: ["listing-with-decimal-engine"] } },
    });

    expect(where.id).toEqual({ in: ["listing-with-decimal-engine"] });
    expect(where.AND).toEqual([visibility]);
    const attributeSql = numericAttributeListingIdQuery([
      { slug: "engine-size", min: 1, max: 2 },
    ]).strings.join(" ");
    expect(attributeSql).not.toMatch(/\bstatus\b/i);
  });
});

// Explicit opt-in only. Normal unit/CI tests never load production credentials.
describe.skipIf(!process.env.NUMERIC_SQL_TEST_DATABASE_URL)("stored decimal execution", () => {
  const client = new pg.Client({ connectionString: process.env.NUMERIC_SQL_TEST_DATABASE_URL });

  afterAll(async () => {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end().catch(() => undefined);
  });

  it("matches decimals and inclusive bounds, and drops blank or malformed values", async () => {
    const probe = Prisma.sql`
      SELECT sample.input,
        ${storedDecimalSql(Prisma.sql`sample.input`)} AS parsed,
        ${storedDecimalSql(Prisma.sql`sample.input`)}
          BETWEEN CAST(${1} AS numeric) AND CAST(${2} AS numeric) AS in_closed_1_to_2,
        ${storedDecimalSql(Prisma.sql`sample.input`)}
          BETWEEN CAST(${0} AS numeric) AND CAST(${999999999} AS numeric) AS in_default_bounds
      FROM (VALUES
        ('1.6'::text),
        ('2'::text),
        ('2.0'::text),
        ('1'::text),
        ('0.9'::text),
        ('2.1'::text),
        ('8.5'::text),
        ('  1.5  '::text),
        (''::text),
        ('   '::text),
        ('n/a'::text),
        ('1.6L'::text),
        ('1,6'::text),
        ('1.2.3'::text),
        ('.5'::text),
        ('999999999'::text),
        ('999999999.1'::text),
        ('1234567'::text),
        ('1234567890'::text),
        (${"9".repeat(10000)}::text)
      ) AS sample(input)
    `;
    const statement = toPg(probe);
    expect(statement.text).not.toContain(STORED_DECIMAL_PATTERN);
    expect(statement.values.filter((value) => value === STORED_DECIMAL_PATTERN)).toHaveLength(3);

    try {
      await client.connect();
    } catch {
      throw new Error("Numeric attribute SQL execution could not connect");
    }
    await client.query("BEGIN READ ONLY");
    const result = await client.query<{
      input: string;
      parsed: string | null;
      in_closed_1_to_2: boolean | null;
      in_default_bounds: boolean | null;
    }>(statement.text, statement.values);
    await client.query("ROLLBACK");

    const byInput = new Map(result.rows.map((row) => [row.input, row]));
    const row = (input: string) => {
      const found = byInput.get(input);
      expect(found, input).toBeTruthy();
      return found!;
    };

    expect(row("1.6").parsed).toBe("1.6");
    expect(row("1.6").in_closed_1_to_2).toBe(true);
    expect(row("2").in_closed_1_to_2).toBe(true);
    expect(row("2.0").in_closed_1_to_2).toBe(true);
    expect(row("1").in_closed_1_to_2).toBe(true);
    expect(row("0.9").in_closed_1_to_2).toBe(false);
    expect(row("2.1").in_closed_1_to_2).toBe(false);
    expect(row("8.5").parsed).toBe("8.5");
    expect(row("8.5").in_closed_1_to_2).toBe(false);
    expect(row("  1.5  ").parsed).toBe("1.5");
    expect(row("  1.5  ").in_closed_1_to_2).toBe(true);
    expect(row(".5").parsed).toBe("0.5");
    expect(row(".5").in_closed_1_to_2).toBe(false);

    for (const input of ["", "   ", "n/a", "1.6L", "1,6", "1.2.3"]) {
      expect(row(input).parsed).toBeNull();
      expect(row(input).in_closed_1_to_2).toBeNull();
    }

    expect(row("999999999").in_default_bounds).toBe(true);
    expect(row("999999999.1").in_default_bounds).toBe(false);
    expect(row("1234567").parsed).toBe("1234567");
    expect(row("1234567890").parsed).toBeNull();
    expect(row("9".repeat(10000)).parsed).toBeNull();
  });
});
