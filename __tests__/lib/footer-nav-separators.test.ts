import { describe, expect, it } from "vitest";
import { sameLineSeparatorVisibility } from "@/lib/footer-nav-separators";

describe("sameLineSeparatorVisibility", () => {
  it("returns no separators for fewer than two items", () => {
    expect(sameLineSeparatorVisibility([])).toEqual([]);
    expect(sameLineSeparatorVisibility([12])).toEqual([]);
  });

  it("shows a dot between items on the same line", () => {
    expect(sameLineSeparatorVisibility([40, 40, 40])).toEqual([true, true]);
  });

  it("hides the dot when adjacent items sit on different lines", () => {
    expect(sameLineSeparatorVisibility([40, 40, 64, 64])).toEqual([
      true,
      false,
      true,
    ]);
  });

  it("hides every dot when each item is on its own line", () => {
    expect(sameLineSeparatorVisibility([10, 30, 50])).toEqual([false, false]);
  });

  it("treats sub-pixel drift on the same line as still aligned", () => {
    expect(sameLineSeparatorVisibility([40, 40.4, 40.8])).toEqual([true, true]);
  });
});
