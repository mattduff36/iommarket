import { describe, expect, it } from "vitest";
import { vehicleCheckSchema } from "@/lib/validations/vehicle-check";

describe("vehicleCheckSchema", () => {
  it("accepts valid UK registrations", () => {
    const result = vehicleCheckSchema.safeParse({ registration: "ab12 cde" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.registration).toBe("AB12CDE");
    }
  });

  it("accepts valid Isle of Man registrations", () => {
    const result = vehicleCheckSchema.safeParse({ registration: "man 123" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.registration).toBe("MAN123");
    }
  });

  it("rejects unsupported registrations", () => {
    const result = vehicleCheckSchema.safeParse({ registration: "not a plate" });
    expect(result.success).toBe(false);
  });

  it("rejects empty registrations", () => {
    const result = vehicleCheckSchema.safeParse({ registration: " " });
    expect(result.success).toBe(false);
  });
});
