import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin user server actions", () => {
  it("does not re-export another module from the use server file", () => {
    const source = readFileSync(resolve(process.cwd(), "actions/admin/users.ts"), "utf8");
    expect(source.startsWith('"use server"')).toBe(true);
    expect(source).not.toMatch(/export\s*\{/);
    expect(source).not.toContain("setDealerTier");
  });
});
