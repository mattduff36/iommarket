import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUserMock } = vi.hoisted(() => ({ getCurrentUserMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: getCurrentUserMock }));

import { GET } from "@/app/api/me/route";

describe("GET /api/me staging access result", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "preview");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the server-computed staging access decision without exposing allowlist data", async () => {
    getCurrentUserMock.mockResolvedValue({
      id: "test-user-id", email: "mattduff36@gmail.com", name: "Test Account", role: "DEALER",
      stagingAccessAllowed: true,
    });

    const response = await GET();
    const body = await response.json();
    expect(body).toMatchObject({ role: "DEALER", stagingAccessAllowed: true });
    expect(body).not.toHaveProperty("verifiedAuthEmail");
    expect(body).not.toHaveProperty("approvedStagingEmails");
  });

  it("does not report staging access in production even for a server-marked staging account", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    getCurrentUserMock.mockResolvedValue({
      id: "test-user-id", email: "mattduff36@gmail.com", name: "Test Account", role: "USER",
      stagingAccessAllowed: true,
    });

    const response = await GET();
    expect((await response.json()).stagingAccessAllowed).toBe(false);
  });
});
