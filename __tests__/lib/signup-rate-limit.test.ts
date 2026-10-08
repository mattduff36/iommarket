/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkSignupRateLimit } from "@/lib/auth/signup-rate-limit";

const dbMocks = vi.hoisted(() => ({
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { $transaction: dbMocks.transaction },
}));

function bucket(count: number) {
  return [{ count, resetAt: new Date("2026-09-29T22:15:00.000Z") }];
}

describe("checkSignupRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.executeRaw.mockResolvedValue(0);
    dbMocks.transaction.mockImplementation(
      async (
        callback: (tx: {
          $executeRaw: typeof dbMocks.executeRaw;
          $queryRaw: typeof dbMocks.queryRaw;
        }) => unknown,
      ) =>
        callback({
          $executeRaw: dbMocks.executeRaw,
          $queryRaw: dbMocks.queryRaw,
        }),
    );
  });

  it("allows attempts at both configured limits without storing raw identifiers", async () => {
    dbMocks.queryRaw
      .mockResolvedValueOnce(bucket(10))
      .mockResolvedValueOnce(bucket(3));

    await expect(
      checkSignupRateLimit({
        email: "member@example.com",
        clientAddress: "203.0.113.10",
        now: new Date("2026-09-29T22:00:00.000Z"),
      }),
    ).resolves.toEqual({ allowed: true, resetAt: new Date("2026-09-29T22:15:00.000Z") });

    expect(dbMocks.executeRaw).toHaveBeenCalledTimes(1);
    expect(dbMocks.queryRaw).toHaveBeenCalledTimes(2);
    const serializedQueries = JSON.stringify(dbMocks.queryRaw.mock.calls);
    expect(serializedQueries).not.toContain("member@example.com");
    expect(serializedQueries).not.toContain("203.0.113.10");
  });

  it("does not create an email bucket after the address limit is exceeded", async () => {
    dbMocks.queryRaw.mockResolvedValueOnce(bucket(11));

    await expect(
      checkSignupRateLimit({
        email: "member@example.com",
        clientAddress: "203.0.113.10",
      }),
    ).resolves.toEqual({ allowed: false, resetAt: new Date("2026-09-29T22:15:00.000Z") });

    expect(dbMocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("denies attempts above the email limit", async () => {
    dbMocks.queryRaw
      .mockResolvedValueOnce(bucket(1))
      .mockResolvedValueOnce(bucket(4));

    await expect(
      checkSignupRateLimit({
        email: "member@example.com",
        clientAddress: "203.0.113.10",
      }),
    ).resolves.toEqual({ allowed: false, resetAt: new Date("2026-09-29T22:15:00.000Z") });
  });

  it("fails closed when a bucket cannot be recorded", async () => {
    dbMocks.queryRaw.mockResolvedValueOnce([]);

    await expect(
      checkSignupRateLimit({
        email: "member@example.com",
        clientAddress: "203.0.113.10",
      }),
    ).rejects.toThrow("Signup rate limit could not be recorded.");
  });
});
