import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const pool = { on: vi.fn() };
  const listingImage = {};
  return {
    pool,
    listingImage,
    createPool: vi.fn(function () { return pool; }),
    createAdapter: vi.fn(function () {}),
    createClient: vi.fn(function () { return { listingImage }; }),
    attachPool: vi.fn(),
  };
});

vi.mock("pg", () => ({ default: { Pool: mocks.createPool } }));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: mocks.createAdapter }));
vi.mock("@prisma/client", () => ({ PrismaClient: mocks.createClient }));
vi.mock("@vercel/functions", () => ({ attachDatabasePool: mocks.attachPool }));

const prismaGlobal = globalThis as typeof globalThis & { prisma?: unknown };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("POSTGRES_URL", "postgresql://test@localhost/test");
});

afterEach(() => {
  delete prismaGlobal.prisma;
  vi.unstubAllEnvs();
});

describe("database pool lifecycle", () => {
  it("attaches the shared Vercel pool once and keeps its existing capacity", async () => {
    vi.stubEnv("VERCEL", "1");
    const { db } = await import("@/lib/db");

    expect(mocks.createPool).not.toHaveBeenCalled();
    expect(db.listingImage).toBe(mocks.listingImage);
    expect(db.listingImage).toBe(mocks.listingImage);
    expect(mocks.createPool).toHaveBeenCalledExactlyOnceWith({
      connectionString: "postgresql://test@localhost/test",
      ssl: false,
      max: 5,
      idleTimeoutMillis: 5_000,
      application_name: "iommarket-web",
    });
    expect(mocks.attachPool).toHaveBeenCalledExactlyOnceWith(mocks.pool);
    expect(mocks.createAdapter).toHaveBeenCalledExactlyOnceWith(mocks.pool);
  });

  it("retains the local pool options without a hosting lifecycle hook", async () => {
    vi.stubEnv("VERCEL", undefined);
    const { db } = await import("@/lib/db");

    expect(db.listingImage).toBe(mocks.listingImage);
    expect(mocks.createPool).toHaveBeenCalledExactlyOnceWith({
      connectionString: "postgresql://test@localhost/test",
      ssl: false,
      max: 5,
    });
    expect(mocks.attachPool).not.toHaveBeenCalled();
  });
});
