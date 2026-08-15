import { describe, expect, it } from "vitest";
import { validateModerationReason } from "@/lib/listings/moderation-reasons";

describe("moderation reasons ALR-LST-003", () => {
  it("requires a reason for adverse actions", () => {
    expect(validateModerationReason({ required: true })).toBe("A reason is required.");
  });

  it("requires notes when the reason is Other", () => {
    expect(
      validateModerationReason({
        required: true,
        reasonCode: "OTHER",
        notes: "   ",
      }),
    ).toBe("Notes are required when the reason is Other.");
    expect(
      validateModerationReason({
        required: true,
        reasonCode: "FRAUD",
        notes: "",
      }),
    ).toBeNull();
  });
});
