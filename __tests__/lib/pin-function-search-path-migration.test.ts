import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const FUNCTION_NAMES = [
  "cost_forbid_mutation",
  "enforce_vehicle_model_name_uniqueness",
  "check_dealer_review_response_approved_revision",
] as const;

const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260822120000_pin_function_search_path/migration.sql",
  ),
  "utf8",
);

function functionBlock(name: (typeof FUNCTION_NAMES)[number]) {
  const match = migration.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${name}\\(\\)[\\s\\S]*?LANGUAGE plpgsql[\\s\\S]*?AS \\$\\$[\\s\\S]*?\\$\\$;`,
    ),
  );
  if (!match) {
    throw new Error(`Missing CREATE OR REPLACE FUNCTION public.${name}()`);
  }
  return match[0];
}

describe("pin function search_path TEST-SEARCH-PATH-001 TEST-SEARCH-PATH-002 TEST-SEARCH-PATH-004 TEST-SEARCH-PATH-005", () => {
  it("replaces the three advisor functions atomically with an empty search_path", () => {
    expect(migration.startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);

    for (const name of FUNCTION_NAMES) {
      const block = functionBlock(name);
      expect(block).toContain("LANGUAGE plpgsql");
      expect(block).toContain("SECURITY INVOKER");
      expect(block).toContain("SET search_path = ''");
      expect(block).not.toMatch(/SECURITY DEFINER/i);
      expect(block).not.toMatch(/SET search_path\s*=\s*public/i);
    }
  });

  it("schema-qualifies queried relations and keeps trigger semantics", () => {
    const cost = functionBlock("cost_forbid_mutation");
    expect(cost).toContain("RAISE EXCEPTION 'cost ledger rows are append-only'");
    expect(cost).not.toMatch(/FROM\s+/i);

    const vehicle = functionBlock("enforce_vehicle_model_name_uniqueness");
    expect(vehicle).toContain('FROM public."VehicleModelAlias"');
    expect(vehicle).toContain('FROM public."VehicleModel"');
    expect(vehicle).not.toMatch(/FROM\s+"VehicleModel(?:Alias)?"/);
    expect(vehicle).toContain("ERRCODE = '23505'");
    expect(vehicle).toContain("ERRCODE = '23503'");
    expect(vehicle).toContain(
      "RAISE EXCEPTION 'vehicle model name conflicts with an alias for this make'",
    );
    expect(vehicle).toContain(
      "RAISE EXCEPTION 'vehicle model alias make does not match its model'",
    );
    expect(vehicle).toContain(
      "RAISE EXCEPTION 'vehicle model alias conflicts with a model name for this make'",
    );
    expect(vehicle).toContain("RETURN NEW;");

    const dealer = functionBlock(
      "check_dealer_review_response_approved_revision",
    );
    expect(dealer).toContain('FROM public."DealerReviewResponse" response');
    expect(dealer).toContain(
      'LEFT JOIN public."DealerReviewResponseRevision" revision',
    );
    expect(dealer).not.toMatch(/FROM\s+"DealerReviewResponse"/);
    expect(dealer).toContain("IF TG_OP = 'DELETE' THEN");
    expect(dealer).toContain(
      "RAISE EXCEPTION 'Approved dealer response must reference its own approved revision'",
    );
    expect(dealer).toContain("RETURN NULL;");
  });

  it("does not drop triggers, add policies, or mutate data", () => {
    expect(migration).not.toMatch(/CREATE POLICY/i);
    expect(migration).not.toMatch(/DROP TRIGGER/i);
    expect(migration).not.toMatch(/DROP FUNCTION/i);
    expect(migration).not.toMatch(/\bDELETE FROM\b/i);
    expect(migration).not.toMatch(/\bUPDATE\s+"/i);
    expect(migration).not.toMatch(/\bINSERT INTO\b/i);
    expect(migration).toContain("prosecdef");
    expect(migration).toContain("expected at least 11 attached triggers");
  });
});
