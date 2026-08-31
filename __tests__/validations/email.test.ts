import { describe, expect, it } from "vitest";
import {
  EMAIL_INVALID_MESSAGE,
  EMAIL_REQUIRED_MESSAGE,
  emailField,
} from "@/lib/validations/email";

describe("emailField FE-01 FE-08", () => {
  it("accepts Isle of Man and Gmail addresses", () => {
    expect(emailField.safeParse("itrader@ac.tmail.im").success).toBe(true);
    expect(emailField.safeParse("user@gmail.com").success).toBe(true);
    expect(emailField.safeParse("name+tag@example.im").success).toBe(true);
  });

  it("rejects empty and invalid addresses with distinct messages", () => {
    const empty = emailField.safeParse("   ");
    expect(empty.success).toBe(false);
    if (!empty.success) {
      expect(empty.error.issues[0]?.message).toBe(EMAIL_REQUIRED_MESSAGE);
    }

    const invalid = emailField.safeParse("not-an-email");
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.issues[0]?.message).toBe(EMAIL_INVALID_MESSAGE);
    }
  });
});
