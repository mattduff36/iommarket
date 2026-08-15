import { afterEach, describe, expect, it, vi } from "vitest";

const { poolOptionsMock } = vi.hoisted(() => ({
  poolOptionsMock: vi.fn(),
}));

vi.mock("pg", () => ({
  default: {
    Pool: class PoolMock {
      constructor(options: unknown) {
        poolOptionsMock(options);
      }
    },
  },
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class PrismaPgMock {
    constructor(_pool: unknown) {}
  },
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClientMock {
    user = {};

    constructor(_options: unknown) {}
  },
}));

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalPostgresUrl = process.env.POSTGRES_URL;
const originalNonPoolingUrl = process.env.POSTGRES_URL_NON_POOLING;
const originalTlsPolicy = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete (globalThis as { prisma?: unknown }).prisma;

  for (const [key, value] of [
    ["DATABASE_URL", originalDatabaseUrl],
    ["POSTGRES_URL", originalPostgresUrl],
    ["POSTGRES_URL_NON_POOLING", originalNonPoolingUrl],
    ["NODE_TLS_REJECT_UNAUTHORIZED", originalTlsPolicy],
  ] as const) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("database TLS scope", () => {
  it("DB-TLS-001 confines the temporary certificate exception to pg.Pool", async () => {
    process.env.DATABASE_URL = "postgresql://user:password@example.com:5432/app";
    delete process.env.POSTGRES_URL;
    delete process.env.POSTGRES_URL_NON_POOLING;
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;

    const { db } = await import("@/lib/db");
    void db.user;

    expect(poolOptionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ssl: { rejectUnauthorized: false },
        max: 5,
      }),
    );
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });
});
