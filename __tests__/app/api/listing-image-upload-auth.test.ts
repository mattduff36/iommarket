import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ auth: vi.fn(), capture: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/policy/gate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/policy/gate")>("@/lib/policy/gate");
  return {
    ...actual,
    requireAcceptedAuth: m.auth,
    acceptedAuthHttpStatus: (error: { statusCode?: number }) => (
      error.statusCode === 401 || error.statusCode === 403 || error.statusCode === 500
        ? error.statusCode
        : actual.acceptedAuthHttpStatus(error)
    ),
  };
});
vi.mock("@/lib/media/config", () => ({ imageKitDevUploadsEnabled: () => true }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: m.rate, makeRateLimitKey: (scope: string, id: string) => `${scope}:${id}` }));
vi.mock("@/lib/monitoring", () => ({ captureException: m.capture }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { POST } from "@/app/api/listing-images/imagekit-upload/route";

function request() {
  return new NextRequest("https://itrader.dev/api/listing-images/imagekit-upload", {
    method: "POST",
    headers: { origin: "https://itrader.dev" },
  });
}

describe("imagekit upload route auth copy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.rate.mockResolvedValue({ allowed: true });
    m.capture.mockResolvedValue({ eventId: "evt_safe_1234" });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("maps 401, 403, and 500 without a generic not-authorized sentence", async () => {
    m.auth.mockRejectedValueOnce({ statusCode: 401 });
    const expired = await POST(request());
    expect(expired.status).toBe(401);
    expect(await expired.json()).toMatchObject({ error: "Sign in again to continue this photo upload." });

    m.auth.mockRejectedValueOnce({ statusCode: 403 });
    const denied = await POST(request());
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: "You don't have permission to upload listing photos." });

    m.auth.mockRejectedValueOnce({ statusCode: 500 });
    const failed = await POST(request());
    expect(failed.status).toBe(500);
    const text = await failed.text();
    expect(text).toContain("We couldn't verify this upload right now.");
    expect(text).toContain("evt_safe_1234");
    expect(text).not.toContain("Not authorized");
  });
});
