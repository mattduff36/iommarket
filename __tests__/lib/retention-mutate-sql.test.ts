import { describe, expect, it } from "vitest";
import {
  dealerReviewRetentionDeleteSql,
  listingRetentionUpdateSql,
  listingViewRetentionDeleteSql,
  reportRetentionUpdateSql,
  sqlHasAtomicHoldExclusion,
  waitlistRetentionAnonymiseSql,
  waitlistRetentionDeleteSql,
} from "@/lib/retention/mutate-sql";

describe("retention mutate SQL POL-RET-001-A", () => {
  const now = new Date("2026-08-15T00:00:00Z");
  const ids = ["id-1", "id-2"];

  it("parameterizes IDs and excludes active holds on every mutate path", () => {
    const statements = [
      listingRetentionUpdateSql(ids, now),
      listingViewRetentionDeleteSql(ids),
      reportRetentionUpdateSql(ids),
      dealerReviewRetentionDeleteSql(ids),
      waitlistRetentionDeleteSql(ids),
      waitlistRetentionAnonymiseSql(ids, now),
    ];

    for (const sql of statements) {
      expect(sqlHasAtomicHoldExclusion(sql)).toBe(true);
      expect(sql.values).toEqual(expect.arrayContaining(ids));
    }
  });
});
