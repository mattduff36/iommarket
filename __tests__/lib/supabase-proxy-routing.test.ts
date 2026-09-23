import { describe, expect, it } from "vitest";
import { shouldBypassSupabaseSessionRefresh } from "@/lib/supabase/proxy-routing";

describe("Supabase proxy routing", () => {
  it("leaves the auth callback as the sole writer of recovery cookies", () => {
    expect(shouldBypassSupabaseSessionRefresh("/auth/callback")).toBe(true);
    expect(
      shouldBypassSupabaseSessionRefresh("/dealer/onboarding/accept"),
    ).toBe(false);
    expect(shouldBypassSupabaseSessionRefresh("/account")).toBe(false);
  });
});
