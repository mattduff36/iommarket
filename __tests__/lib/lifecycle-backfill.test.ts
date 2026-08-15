import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyApprovedBackfill,
  classifyTakenDownBackfill,
} from "@/lib/listings/backfill";

const backfill = readFileSync(
  resolve(process.cwd(), "prisma/migrations/20260815002000_lifecycle_backfill/migration.sql"),
  "utf8",
);

const NOW = new Date("2026-08-15T00:00:00.000Z");

describe("lifecycle backfill ALR-DAT-001", () => {
  it("only writes events for rows that actually changed", () => {
    expect(backfill).toContain("RETURNING id");
    expect(backfill).toContain("FROM approved_to_live");
    expect(backfill).toContain("FROM taken_down_to_rejected");
  });

  it("maps unused APPROVED conservatively and leaves ambiguous takedowns in place", () => {
    expect(backfill).toContain("WHERE status = 'APPROVED'");
    expect(backfill).toContain("AND \"expiresAt\" > NOW()");
    expect(backfill).toContain("= 'PENDING'");
    expect(backfill).not.toMatch(/DELETE FROM "Listing"/i);
    expect(backfill).toContain("Ambiguous TAKEN_DOWN rows stay TAKEN_DOWN");
  });

  it("classifies APPROVED rows the same way as the SQL predicates", () => {
    expect(
      classifyApprovedBackfill(new Date("2026-09-01T00:00:00.000Z"), NOW),
    ).toBe("LIVE");
    expect(
      classifyApprovedBackfill(new Date("2026-08-01T00:00:00.000Z"), NOW),
    ).toBe("PENDING");
    expect(classifyApprovedBackfill(null, NOW)).toBe("PENDING");
  });

  it("reclassifies TAKEN_DOWN only when the latest inbound event is PENDING", () => {
    expect(classifyTakenDownBackfill("PENDING")).toBe("REJECTED");
    expect(classifyTakenDownBackfill("LIVE")).toBeNull();
    expect(classifyTakenDownBackfill("APPROVED")).toBeNull();
    expect(classifyTakenDownBackfill(null)).toBeNull();
  });
});
