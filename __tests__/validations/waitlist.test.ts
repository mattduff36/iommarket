import { describe, expect, it } from "vitest";
import { joinWaitlistSchema } from "@/lib/validations/waitlist";

describe("joinWaitlistSchema", () => {
  it("accepts valid input", () => {
    const result = joinWaitlistSchema.safeParse({
      email: "driver@example.com",
      interests: ["BUYING_CARS", "DEALER"],
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = joinWaitlistSchema.safeParse({
      email: "invalid-email",
      interests: ["BUYING_CARS"],
    });

    expect(result.success).toBe(false);
  });

  it("rejects empty interests", () => {
    const result = joinWaitlistSchema.safeParse({
      email: "driver@example.com",
      interests: [],
    });

    expect(result.success).toBe(false);
  });
});
