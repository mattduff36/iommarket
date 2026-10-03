import { describe, expect, it } from "vitest";
import { publicAuthErrorMessage } from "@/lib/forms/action-error";
import {
  publicPasswordPolicyMessage,
  supabasePasswordErrorMessage,
} from "@/lib/forms/password-policy-message";

const PWNED =
  "Password is known to be weak and easy to guess, please choose a different one.";
const CHARACTERS =
  "Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789, !@#$%^&*()_+-=[]{};':\"|<>?,./`~.";

describe("publicPasswordPolicyMessage", () => {
  it("keeps Supabase password policy sentences", () => {
    expect(publicPasswordPolicyMessage("Password should be at least 8 characters.")).toBe(
      "Password should be at least 8 characters.",
    );
    expect(publicPasswordPolicyMessage(PWNED)).toBe(PWNED);
    expect(publicPasswordPolicyMessage(CHARACTERS)).toBe(CHARACTERS);
    expect(
      publicPasswordPolicyMessage(
        `Password should be at least 8 characters. ${CHARACTERS} ${PWNED}`,
      ),
    ).toBe(`Password should be at least 8 characters. ${CHARACTERS} ${PWNED}`);
    expect(
      publicPasswordPolicyMessage("Password cannot be longer than 72 characters"),
    ).toBe("Password cannot be longer than 72 characters.");
  });

  it("hides provider text that is not a password policy error", () => {
    expect(publicPasswordPolicyMessage("Database error creating new user")).toBeNull();
    expect(
      publicPasswordPolicyMessage("Password should be at least 8 characters. See https://example.com"),
    ).toBeNull();
  });
});

describe("supabasePasswordErrorMessage", () => {
  it("uses weak-password reasons when the provider message is not recognized", () => {
    expect(
      supabasePasswordErrorMessage({
        message: "weak password",
        code: "weak_password",
        reasons: ["pwned", "characters"],
      }),
    ).toBe(
      `Password should contain at least one character from each required set. ${PWNED}`,
    );
  });

  it("does not treat unrelated auth failures as password errors", () => {
    expect(
      supabasePasswordErrorMessage({ message: "Database error creating new user" }),
    ).toBeNull();
  });
});

describe("publicAuthErrorMessage password policy", () => {
  it("shows the supabase password error instead of the account fallback", () => {
    expect(publicAuthErrorMessage(PWNED, "We could not create your account. Please try again shortly.")).toBe(
      PWNED,
    );
  });
});
