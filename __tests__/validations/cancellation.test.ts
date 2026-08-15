import { describe, expect, it } from "vitest";
import {
  requestDealerCancellationSchema,
  staffCancellationActionSchema,
} from "@/lib/validations/cancellation";

describe("cancellation validation POL-CANCEL-001", () => {
  it("requires an explicit dealer confirmation", () => {
    expect(requestDealerCancellationSchema.safeParse({ confirmation: false }).success).toBe(
      false,
    );
    expect(requestDealerCancellationSchema.safeParse({ confirmation: true }).success).toBe(
      true,
    );
  });

  it("accepts staff actions on a request id", () => {
    const result = staffCancellationActionSchema.safeParse({
      requestId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      action: "ACKNOWLEDGE",
      notes: "Ripple portal updated",
    });
    expect(result.success).toBe(true);
  });
});
