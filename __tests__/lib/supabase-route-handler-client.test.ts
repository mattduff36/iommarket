import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import { applySupabaseResponseCookies } from "@/lib/supabase/server";

describe("Supabase route-handler cookies", () => {
  it("copies cookies written during OTP verification onto the redirect response", () => {
    const response = applySupabaseResponseCookies(
      NextResponse.redirect("https://itrader.im/dealer/onboarding/accept"),
      [
      {
        name: "sb-session",
        value: "session-value",
        options: { httpOnly: true, path: "/" },
      },
      ],
    );

    expect(response.cookies.get("sb-session")?.value).toBe("session-value");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });
});
