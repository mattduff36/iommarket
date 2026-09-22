import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccountDisabledError,
  AuthenticationRequiredError,
  InsufficientPermissionsError,
} from "@/lib/auth";

const { requireRoleMock, findManyMock, captureExceptionMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  findManyMock: vi.fn(),
  captureExceptionMock: vi.fn(),
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...actual, requireRole: requireRoleMock };
});
vi.mock("@/lib/db", () => ({
  db: { waitlistUser: { findMany: findManyMock } },
}));
vi.mock("@/lib/monitoring", () => ({
  captureException: captureExceptionMock,
}));

describe("GET /api/admin/waitlist/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captureExceptionMock.mockResolvedValue(null);
  });

  it("returns 401, 403, or CSV and monitors unexpected failures", async () => {
    const { GET } = await import("@/app/api/admin/waitlist/export/route");

    requireRoleMock.mockRejectedValueOnce(new AuthenticationRequiredError());
    const unauthenticated = await GET();
    expect(unauthenticated.status).toBe(401);

    requireRoleMock.mockRejectedValueOnce(new InsufficientPermissionsError());
    const forbidden = await GET();
    expect(forbidden.status).toBe(403);

    requireRoleMock.mockRejectedValueOnce(new AccountDisabledError());
    expect((await GET()).status).toBe(403);

    requireRoleMock.mockRejectedValueOnce(new Error("database exploded"));
    const unexpected = await GET();
    expect(unexpected.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledOnce();

    requireRoleMock.mockResolvedValueOnce({ id: "admin", role: "ADMIN" });
    findManyMock.mockResolvedValueOnce([
      {
        email: "person@example.im",
        interests: ["BUYING_CARS"],
        source: "holding",
        createdAt: new Date("2026-09-22T00:00:00.000Z"),
      },
    ]);
    const csv = await GET();
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    await expect(csv.text()).resolves.toContain("person@example.im,Buying cars,holding,");
  });
});
