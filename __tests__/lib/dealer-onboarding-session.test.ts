import { describe, expect, it } from "vitest";
import { isOnboardingSessionStale } from "@/lib/dealers/onboarding/session-cutoff";

function token(iat: number) {
  const payload = Buffer.from(JSON.stringify({ iat })).toString("base64url");
  return `header.${payload}.signature`;
}

describe("revoked onboarding sessions", () => {
  it("rejects a recovered session issued before the invite was revoked", () => {
    const metadata = { onboarding_session_invalid_before: 1_700_000_100 };
    expect(isOnboardingSessionStale(metadata, token(1_700_000_000))).toBe(true);
    expect(isOnboardingSessionStale(metadata, token(1_700_000_100))).toBe(true);
    expect(isOnboardingSessionStale(metadata, token(1_700_000_101))).toBe(false);
    expect(isOnboardingSessionStale(metadata, null)).toBe(true);
    expect(isOnboardingSessionStale({}, token(1_700_000_000))).toBe(false);
  });
});
