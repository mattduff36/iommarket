import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildDatabasePoolOptions } from "@/lib/db/pool-options";

const originalTlsPolicy = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

afterEach(() => {
  if (originalTlsPolicy === undefined) {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  } else {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTlsPolicy;
  }
});

describe("database TLS scope", () => {
  it("DB-TLS-001 confines the temporary certificate exception to pg pool options", async () => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;

    const options = buildDatabasePoolOptions(
      "postgresql://user:password@example.com:5432/app?sslmode=require&pgbouncer=true&supa=ref",
    );

    expect(options.connectionString).toBe(
      "postgresql://user:password@example.com:5432/app",
    );
    expect(options.ssl).toEqual({ rejectUnauthorized: false });
    expect(options.max).toBe(5);

    await import("@/lib/db");

    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();

    const dbSource = readFileSync(join(process.cwd(), "lib/db/index.ts"), "utf8");
    expect(dbSource).toContain("buildDatabasePoolOptions");
    expect(dbSource).toContain("new pg.Pool(");
    expect(dbSource).not.toContain("NODE_TLS_REJECT_UNAUTHORIZED");
  });
});
