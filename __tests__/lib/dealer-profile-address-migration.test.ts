import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20261001120000_dealer_profile_slug_history/migration.sql",
  ),
  "utf8",
);

describe("dealer profile address reservation migration", () => {
  it("guards current slug inserts and updates for every database writer", () => {
    expect(migration).toContain(
      'BEFORE INSERT OR UPDATE OF "slug" ON public."DealerProfile"',
    );
    expect(migration).toContain("pg_advisory_xact_lock(hashtextextended");
    expect(migration).toContain('FROM public."DealerProfileSlugHistory" h');
    expect(migration).toContain('NEW."slug"');
  });

  it("records each old slug and excludes the generated first-choice placeholder from quota", () => {
    expect(migration).toContain(
      'AFTER UPDATE OF "slug" ON public."DealerProfile"',
    );
    expect(migration).toContain('OLD."slug"');
    expect(migration).toContain("app.dealer_profile_address_source");
    expect(migration).toContain("'dealer-' || OLD.\"userId\"");
    expect(migration).toContain('"countsTowardsLimit"');
  });

  it("prevents aliases from colliding with current slugs and retains them on profile deletion", () => {
    expect(migration).toContain('FROM public."DealerProfile" d');
    expect(migration).toContain('ON DELETE SET NULL');
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON public.\"DealerProfileSlugHistory\"");
    expect(migration).toContain(
      "NOT (OLD.\"dealerId\" IS NOT NULL AND NEW.\"dealerId\" IS NULL)",
    );
    expect(migration).toContain(
      'ALTER TABLE "public"."DealerProfileSlugHistory" ENABLE ROW LEVEL SECURITY',
    );
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE)\b/i);
  });
});
