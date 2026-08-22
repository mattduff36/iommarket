import { describe, expect, it } from "vitest";
import { isSchemaPath, isSecretPath, summarizeFinaliseChanges } from "../../../scripts/finalise/summary";

describe("finalise change summaries", () => {
  it("describes finalise automation work from scripts and tests", () => {
    const summary = summarizeFinaliseChanges([
      "scripts/finalise.ts",
      "scripts/finalise/summary.ts",
      "__tests__/scripts/finalise/summary.test.ts",
    ]);

    expect(summary.commitMessage).toBe("feat: update scripts and __tests__");
    expect(summary.areas).toEqual(["scripts", "__tests__"]);
    expect(summary.fileCount).toBe(3);
  });

  it("uses a docs commit when only markdown changed", () => {
    expect(summarizeFinaliseChanges(["AGENTS.md", "README.md"]).commitMessage).toBe(
      "docs: update agents and readme",
    );
  });

  it("uses a test commit when only test files changed", () => {
    expect(summarizeFinaliseChanges(["__tests__/scripts/finalise/summary.test.ts"]).commitMessage).toBe(
      "test: update __tests__",
    );
  });

  it("flags schema files without treating them as secrets", () => {
    expect(isSchemaPath("prisma/schema.prisma")).toBe(true);
    expect(isSchemaPath("prisma/migrations/20260101_init/migration.sql")).toBe(true);
    expect(isSchemaPath("supabase/migrations/20260101_init.sql")).toBe(true);
    expect(isSchemaPath("app/page.tsx")).toBe(false);
    expect(summarizeFinaliseChanges(["prisma/schema.prisma"]).schemaFiles).toEqual(["prisma/schema.prisma"]);
  });

  it("refuses secret-like paths", () => {
    expect(isSecretPath(".env")).toBe(true);
    expect(isSecretPath(".env.local")).toBe(true);
    expect(isSecretPath(".cursor/mcp.json")).toBe(true);
    expect(isSecretPath("certs/server.pem")).toBe(true);
    expect(isSecretPath("credentials.json")).toBe(true);
    expect(isSecretPath("app/page.tsx")).toBe(false);
    expect(summarizeFinaliseChanges([".env.production", "lib/env.ts"]).secretFiles).toEqual([".env.production"]);
  });
});
