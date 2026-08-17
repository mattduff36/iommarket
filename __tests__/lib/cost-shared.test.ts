import { describe, expect, it } from "vitest";
import { allocateSharedPence } from "@/lib/costs/shared";

describe("COST-SHARED-001 equal project allocation", () => {
  it("conserves marked pence with deterministic remainders", () => {
    const ids = ["prj_c", "prj_a", "prj_b"];
    const first = allocateSharedPence(10n, ids, "prj_a");
    const second = allocateSharedPence(10n, ids, "prj_b");
    const third = allocateSharedPence(10n, ids, "prj_c");
    const outsider = allocateSharedPence(10n, ids, "prj_other");

    expect(first.membership).toEqual(["prj_a", "prj_b", "prj_c"]);
    expect(first.share + second.share + third.share).toBe(10n);
    expect(first.share).toBe(4n);
    expect(second.share).toBe(3n);
    expect(third.share).toBe(3n);
    expect(outsider.share).toBe(0n);

    const negative = ["prj_z", "prj_a"].map((id) => allocateSharedPence(-5n, ["prj_z", "prj_a"], id));
    expect(negative[0].share + negative[1].share).toBe(-5n);
  });
});
