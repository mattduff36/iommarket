import { describe, expect, it } from "vitest";
import {
  assertRexRecordsSafe,
  removalConfirmation,
} from "../../scripts/archive-remove-rex";

type RexRecords = Parameters<typeof assertRexRecordsSafe>[0];

describe("Rex archive and removal safety", () => {
  it("uses a target-specific destructive confirmation", () => {
    expect(removalConfirmation("preview")).toBe(
      "yes archive and remove rex-motor-company from preview",
    );
    expect(removalConfirmation("production")).toBe(
      "yes archive and remove rex-motor-company from production",
    );
  });

  it("accepts an absent target and rejects unrelated records", () => {
    expect(() =>
      assertRexRecordsSafe({
        packs: [],
        profiles: [],
        users: [],
        listings: [],
      }),
    ).not.toThrow();

    expect(() =>
      assertRexRecordsSafe({
        packs: [],
        profiles: [],
        users: [{ id: "other", email: "other@example.com" }],
        listings: [],
      } as unknown as RexRecords),
    ).toThrow(/unsafe identity/);
  });
});
