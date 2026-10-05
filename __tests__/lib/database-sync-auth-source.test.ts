import { describe, expect, it } from "vitest";
import { authSourceMode, sourceAuthTable, AUTH_EXPORT_SCHEMA } from "@/lib/database-sync/auth-source";

describe("explicit production Auth source selection", () => {
  it("retains direct access unless the private-view contract is explicitly selected", () => {
    expect(authSourceMode({})).toBe("direct");
    expect(sourceAuthTable("users", {})).toBe("auth.users");
    expect(sourceAuthTable("identities", {})).toBe("auth.identities");
  });

  it("maps only the two source Auth relations to fixed private views", () => {
    const env = { DATABASE_SYNC_AUTH_SOURCE_MODE: "private-views" };
    expect(sourceAuthTable("users", env)).toBe(`"${AUTH_EXPORT_SCHEMA}"."auth_users"`);
    expect(sourceAuthTable("identities", env)).toBe(`"${AUTH_EXPORT_SCHEMA}"."auth_identities"`);
  });

  it.each(["auto", "fallback", "PRIVATE", "private-views; DROP SCHEMA auth"])("fails closed for invalid mode %s", (mode) => {
    expect(() => authSourceMode({ DATABASE_SYNC_AUTH_SOURCE_MODE: mode })).toThrow("DATABASE_SYNC_AUTH_SOURCE_MODE");
  });

  it("refuses unknown Auth table names", () => {
    expect(() => sourceAuthTable("sessions", {})).toThrow("Unsupported source Auth relation");
  });
});
