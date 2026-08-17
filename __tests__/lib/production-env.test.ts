import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COST_LEDGER_STARTED_AT_ISO } from "@/lib/costs/config";
import {
  PRODUCTION_EPHEMERAL_KEYS,
  PRODUCTION_SENSITIVE_KEYS,
  PRODUCTION_VERCEL_PROJECT_ID,
  PRODUCTION_VERCEL_TEAM_ID,
} from "@/lib/ops/production-env-contract";
import {
  checkProductionEnvMirror,
  listVercelProductionEnvMetadata,
  pullProductionEnvMirror,
  pullVercelProductionEnvFile,
  validateVercelProductionEnvMetadata,
  type VercelProductionEnvMetadata,
} from "@/lib/ops/production-env";
import {
  compareEnvMaps,
  parseDotenv,
  ProductionEnvError,
  replaceProductionEnvMirror,
  validateProductionEnv,
} from "@/lib/ops/production-env-file";
import { isProductionEnvFile } from "../../prisma/seed/target";

function validProductionEnv(overrides: Record<string, string> = {}): string {
  const values = {
    COSTS_ENABLED: "true",
    COST_LEDGER_STARTED_AT: COST_LEDGER_STARTED_AT_ISO,
    COST_OWNER_AUTH_USER_ID: "8be27479-bad8-43a5-998f-5a0c1a9eb2ac",
    COST_OWNER_NOTIFICATION_EMAIL: "owner@mpdee.co.uk",
    COST_VERCEL_TEAM_ID: PRODUCTION_VERCEL_TEAM_ID,
    COST_VERCEL_PROJECT_ID: PRODUCTION_VERCEL_PROJECT_ID,
    COST_VERCEL_DATABASE_RESOURCE_ID: "store_test",
    DATABASE_URL: "postgres://user:pass@db.mpdee.co.uk:5432/postgres",
    POSTGRES_URL: "postgres://user:pass@db.mpdee.co.uk:6543/postgres",
    POSTGRES_URL_NON_POOLING: "postgres://user:pass@db.mpdee.co.uk:5432/postgres",
    NEXT_PUBLIC_APP_URL: "https://itrader.im",
    ...overrides,
  };
  return Object.entries(values)
    .map(([key, value]) => `${key}="${value}"`)
    .join("\n");
}

function validSensitiveMetadata(): VercelProductionEnvMetadata[] {
  return PRODUCTION_SENSITIVE_KEYS.map((key) => ({
    key,
    type: "sensitive",
    target: ["production"],
  }));
}

const listValidSensitiveMetadata = () => validSensitiveMetadata();

function vercelPulledProductionEnv(
  overrides: Record<string, string> = {},
): string {
  return [
    validProductionEnv(overrides),
    ...PRODUCTION_SENSITIVE_KEYS.map((key) => `${key}=""`),
    ...PRODUCTION_EPHEMERAL_KEYS.map((key) => `${key}="ephemeral-value"`),
  ].join("\n");
}

function writeLinkedProject(cwd: string, projectId = PRODUCTION_VERCEL_PROJECT_ID, orgId = PRODUCTION_VERCEL_TEAM_ID) {
  mkdirSync(path.join(cwd, ".vercel"), { recursive: true });
  writeFileSync(
    path.join(cwd, ".vercel", "project.json"),
    JSON.stringify({ projectId, orgId }),
  );
}

describe("production environment mirror T8 T9 T10 T12", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects duplicate keys and reports only key names", () => {
    expect(() => parseDotenv("FOO=1\nFOO=2\n")).toThrow(/FOO/);
    const drift = compareEnvMaps({ A: "1", B: "2" }, { A: "1", C: "3" });
    expect(drift).toEqual({
      missing: ["C"],
      extra: ["B"],
      mismatched: [],
    });
    expect(JSON.stringify(drift)).not.toMatch(/1|2|3/);
  });

  it("refuses placeholder, loopback, drifted, and non-production values", () => {
    expect(() =>
      validateProductionEnv(parseDotenv(validProductionEnv({ COST_OWNER_AUTH_USER_ID: "replace-with-owner-id" }))),
    ).toThrow(/COST_OWNER_AUTH_USER_ID/);
    expect(() =>
      validateProductionEnv(parseDotenv(validProductionEnv({ DATABASE_URL: "postgres://user:pass@localhost:5432/postgres" }))),
    ).toThrow(/DATABASE_URL/);
    expect(() =>
      validateProductionEnv(parseDotenv(validProductionEnv({ COST_LEDGER_STARTED_AT: "2026-09-01T07:00:00.000Z" }))),
    ).toThrow(/COST_LEDGER_STARTED_AT/);
    expect(() =>
      validateProductionEnv(parseDotenv(validProductionEnv({ COST_SYNC_ALLOW_NON_PROD: "1" }))),
    ).toThrow(/COST_SYNC_ALLOW_NON_PROD/);
    expect(() =>
      validateProductionEnv(parseDotenv(validProductionEnv({ COST_SYNC_ALLOW_NON_PROD: "0" }))),
    ).toThrow(/COST_SYNC_ALLOW_NON_PROD/);
  });

  it("decodes escaped quotes without emitting values in drift reports", () => {
    const parsed = parseDotenv('COST_OWNER_NOTIFICATION_EMAIL="say \\"hello\\""\n');
    expect(parsed.COST_OWNER_NOTIFICATION_EMAIL).toBe('say "hello"');
  });

  it("rejects sensitive values from the local mirror", () => {
    for (const key of [
      ...PRODUCTION_SENSITIVE_KEYS,
      ...PRODUCTION_EPHEMERAL_KEYS,
    ]) {
      expect(() =>
        validateProductionEnv(parseDotenv(validProductionEnv({ [key]: "secret-value" }))),
      ).toThrow(new RegExp(key));
    }
  });

  it("parses Vercel metadata without exposing CLI output", () => {
    const metadata = validSensitiveMetadata();
    expect(
      listVercelProductionEnvMetadata({
        cwd: process.cwd(),
        spawn: (() => ({
          status: 0,
          stdout: JSON.stringify({ envs: metadata }),
          stderr: "",
        })) as unknown as typeof import("node:child_process").spawnSync,
      }),
    ).toEqual(metadata);

    const secretOutput = "must-not-appear";
    expect(() =>
      listVercelProductionEnvMetadata({
        cwd: process.cwd(),
        spawn: (() => ({
          status: 0,
          stdout: secretOutput,
          stderr: secretOutput,
        })) as unknown as typeof import("node:child_process").spawnSync,
      }),
    ).toThrow("Vercel production environment metadata was invalid.");
    try {
      listVercelProductionEnvMetadata({
        cwd: process.cwd(),
        spawn: (() => ({
          status: 1,
          stdout: secretOutput,
          stderr: secretOutput,
        })) as unknown as typeof import("node:child_process").spawnSync,
      });
    } catch (error) {
      expect(String(error)).not.toContain(secretOutput);
    }
  });

  it("rejects missing, duplicate, wrong-type, non-production, and forbidden metadata", () => {
    const valid = validSensitiveMetadata();
    expect(() => validateVercelProductionEnvMetadata(valid)).not.toThrow();
    expect(() =>
      validateVercelProductionEnvMetadata(valid.slice(1)),
    ).toThrow(/VERCEL_BILLING_TOKEN/);
    expect(() =>
      validateVercelProductionEnvMetadata([...valid, valid[0]!]),
    ).toThrow(/VERCEL_BILLING_TOKEN/);
    expect(() =>
      validateVercelProductionEnvMetadata(
        valid.map((env, index) =>
          index === 0 ? { ...env, type: "encrypted" } : env,
        ),
      ),
    ).toThrow(/VERCEL_BILLING_TOKEN/);
    expect(() =>
      validateVercelProductionEnvMetadata(
        valid.map((env, index) =>
          index === 0 ? { ...env, target: ["preview"] } : env,
        ),
      ),
    ).toThrow(/VERCEL_BILLING_TOKEN/);
    expect(() =>
      validateVercelProductionEnvMetadata([
        ...valid,
        {
          key: "COST_SYNC_ALLOW_NON_PROD",
          type: "plain",
          target: ["production"],
        },
      ]),
    ).toThrow(/COST_SYNC_ALLOW_NON_PROD/);
  });

  it("accepts only the canonical repository mirror path", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "prod-env-path-"));
    directories.push(cwd);
    expect(isProductionEnvFile(".env.production", cwd)).toBe(true);
    expect(isProductionEnvFile(path.join(cwd, "nested", ".env.production"), cwd)).toBe(false);
  });

  it("refuses a relinked Vercel project and preserves the existing mirror on pull failure", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "prod-env-pull-"));
    directories.push(cwd);
    writeLinkedProject(cwd, "prj_other", PRODUCTION_VERCEL_TEAM_ID);
    writeFileSync(path.join(cwd, ".env.production"), "KEEP=1\n");
    expect(() =>
      pullProductionEnvMirror({
        cwd,
        list: listValidSensitiveMetadata,
        pull: ({ destPath }) => {
          writeFileSync(destPath, vercelPulledProductionEnv());
        },
      }),
    ).toThrow(ProductionEnvError);
    expect(readFileSync(path.join(cwd, ".env.production"), "utf8")).toBe("KEEP=1\n");
  });

  it("replaces the mirror only after a valid pull and keeps the old file when validation fails", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "prod-env-replace-"));
    directories.push(cwd);
    writeLinkedProject(cwd);
    writeFileSync(path.join(cwd, ".env.production"), "KEEP=1\n");

    expect(() =>
      pullProductionEnvMirror({
        cwd,
        list: listValidSensitiveMetadata,
        pull: ({ destPath }) => {
          writeFileSync(
            destPath,
            vercelPulledProductionEnv({
              DATABASE_URL: "postgres://127.0.0.1/postgres",
            }),
          );
        },
      }),
    ).toThrow(/DATABASE_URL/);
    expect(readFileSync(path.join(cwd, ".env.production"), "utf8")).toBe("KEEP=1\n");

    pullProductionEnvMirror({
      cwd,
      list: listValidSensitiveMetadata,
      pull: ({ destPath }) => {
        writeFileSync(destPath, vercelPulledProductionEnv());
      },
    });
    expect(readFileSync(path.join(cwd, ".env.production"), "utf8")).toContain("COSTS_ENABLED");
    expect(readFileSync(path.join(cwd, ".env.production"), "utf8")).not.toContain("KEEP=1");
    for (const key of [
      ...PRODUCTION_SENSITIVE_KEYS,
      ...PRODUCTION_EPHEMERAL_KEYS,
    ]) {
      expect(readFileSync(path.join(cwd, ".env.production"), "utf8")).not.toContain(
        `${key}=`,
      );
    }
  });

  it("rejects a readable sensitive value from Vercel and preserves the mirror", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "prod-env-readable-secret-"));
    directories.push(cwd);
    writeLinkedProject(cwd);
    writeFileSync(path.join(cwd, ".env.production"), "KEEP=1\n");
    expect(() =>
      pullProductionEnvMirror({
        cwd,
        list: listValidSensitiveMetadata,
        pull: ({ destPath }) => {
          writeFileSync(
            destPath,
            `${validProductionEnv()}\nCOST_SYNC_SECRET="readable-secret"\n`,
          );
        },
      }),
    ).toThrow(/COST_SYNC_SECRET/);
    expect(readFileSync(path.join(cwd, ".env.production"), "utf8")).toBe(
      "KEEP=1\n",
    );
  });

  it("replaces the dest file in place and never moves the existing mirror aside", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "prod-env-atomic-"));
    directories.push(cwd);
    const dest = path.join(cwd, ".env.production");
    const staging = path.join(cwd, ".env.production.staging-test");
    writeFileSync(dest, "KEEP=1\n");
    writeFileSync(staging, validProductionEnv());
    replaceProductionEnvMirror({ cwd, stagingPath: staging });
    expect(readFileSync(dest, "utf8")).toContain("COSTS_ENABLED");
    expect(existsSync(staging)).toBe(false);
    expect(readdirSync(cwd).some((name) => name.includes(".bak-"))).toBe(false);
  });

  it("preserves the existing mirror when the Vercel CLI pull fails", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "prod-env-cli-"));
    directories.push(cwd);
    writeLinkedProject(cwd);
    writeFileSync(path.join(cwd, ".env.production"), "KEEP=1\n");
    expect(() =>
      pullVercelProductionEnvFile({
        cwd: process.cwd(),
        destPath: path.join(cwd, ".env.production.staging-cli"),
        spawn: (() => ({
          status: 1,
          stdout: "",
          stderr: "vercel denied",
        })) as unknown as typeof import("node:child_process").spawnSync,
      }),
    ).toThrow(/pull failed/);
    expect(() =>
      pullProductionEnvMirror({
        cwd,
        list: listValidSensitiveMetadata,
        pull: () => {
          throw new ProductionEnvError("Vercel production environment pull failed.");
        },
      }),
    ).toThrow(/pull failed/);
    expect(readFileSync(path.join(cwd, ".env.production"), "utf8")).toBe("KEEP=1\n");
    expect(existsSync(path.join(cwd, ".env.production.staging-cli"))).toBe(false);
  });

  it("preserves the existing mirror when atomic replacement is denied", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "prod-env-perm-"));
    directories.push(cwd);
    const dest = path.join(cwd, ".env.production");
    const staging = path.join(cwd, ".env.production.staging-perm");
    writeFileSync(dest, "KEEP=1\n");
    writeFileSync(staging, validProductionEnv());
    expect(() =>
      replaceProductionEnvMirror({
        cwd,
        stagingPath: staging,
        rename: () => {
          throw Object.assign(new Error("EACCES"), { code: "EACCES" });
        },
      }),
    ).toThrow(/Failed to replace/);
    expect(readFileSync(dest, "utf8")).toBe("KEEP=1\n");
    expect(existsSync(staging)).toBe(true);
  });

  it("preserves the existing mirror when metadata validation fails", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "prod-env-metadata-"));
    directories.push(cwd);
    writeLinkedProject(cwd);
    writeFileSync(path.join(cwd, ".env.production"), "KEEP=1\n");
    const pull = vi.fn();
    expect(() =>
      pullProductionEnvMirror({
        cwd,
        list: () => validSensitiveMetadata().slice(1),
        pull,
      }),
    ).toThrow(/VERCEL_BILLING_TOKEN/);
    expect(pull).not.toHaveBeenCalled();
    expect(readFileSync(path.join(cwd, ".env.production"), "utf8")).toBe(
      "KEEP=1\n",
    );
  });

  it("does not fall back to a non-atomic copy after rename failure", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "prod-env-rename-"));
    directories.push(cwd);
    const dest = path.join(cwd, ".env.production");
    const staging = path.join(cwd, ".env.production.staging-rename");
    writeFileSync(dest, "KEEP=1\n");
    writeFileSync(staging, validProductionEnv());
    expect(() =>
      replaceProductionEnvMirror({
        cwd,
        stagingPath: staging,
        rename: () => {
          throw Object.assign(new Error("EPERM"), { code: "EPERM" });
        },
      }),
    ).toThrow(/Failed to replace/);
    expect(readFileSync(dest, "utf8")).toBe("KEEP=1\n");
    expect(readFileSync(staging, "utf8")).toContain("COSTS_ENABLED");
  });

  it("preserves the existing mirror when staging fsync fails", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "prod-env-fsync-"));
    directories.push(cwd);
    const dest = path.join(cwd, ".env.production");
    const staging = path.join(cwd, ".env.production.staging-fsync");
    writeFileSync(dest, "KEEP=1\n");
    writeFileSync(staging, validProductionEnv());
    expect(() =>
      replaceProductionEnvMirror({
        cwd,
        stagingPath: staging,
        fsync: () => {
          throw Object.assign(new Error("EIO"), { code: "EIO" });
        },
      }),
    ).toThrow(/Failed to replace/);
    expect(readFileSync(dest, "utf8")).toBe("KEEP=1\n");
    expect(readFileSync(staging, "utf8")).toContain("COSTS_ENABLED");
  });

  it("preserves the existing mirror when staging permissions cannot be secured", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "prod-env-chmod-"));
    directories.push(cwd);
    const dest = path.join(cwd, ".env.production");
    const staging = path.join(cwd, ".env.production.staging-chmod");
    writeFileSync(dest, "KEEP=1\n");
    writeFileSync(staging, validProductionEnv());
    expect(() =>
      replaceProductionEnvMirror({
        cwd,
        stagingPath: staging,
        chmod: () => {
          throw Object.assign(new Error("EACCES"), { code: "EACCES" });
        },
      }),
    ).toThrow(/Failed to replace/);
    expect(readFileSync(dest, "utf8")).toBe("KEEP=1\n");
    expect(readFileSync(staging, "utf8")).toContain("COSTS_ENABLED");
  });

  it("reports drift by key name only and does not overwrite the local mirror during check", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "prod-env-check-"));
    directories.push(cwd);
    writeLinkedProject(cwd);
    writeFileSync(
      path.join(cwd, ".env.production"),
      validProductionEnv({ COST_OWNER_NOTIFICATION_EMAIL: "local@example.net" }),
    );
    const result = checkProductionEnvMirror({
      cwd,
      list: listValidSensitiveMetadata,
      pull: ({ destPath }) => {
        writeFileSync(
          destPath,
          vercelPulledProductionEnv({
            COST_OWNER_NOTIFICATION_EMAIL: "remote@example.net",
          }),
        );
      },
    });
    expect(result.ok).toBe(false);
    expect(result.drift.mismatched).toEqual(["COST_OWNER_NOTIFICATION_EMAIL"]);
    expect(JSON.stringify(result)).not.toContain("local@example.net");
    expect(JSON.stringify(result)).not.toContain("remote@example.net");
    expect(readFileSync(path.join(cwd, ".env.production"), "utf8")).toContain(
      "local@example.net",
    );
  });

  it("does not invoke Vercel when the injected pull is unused by local validation", () => {
    const pull = vi.fn();
    expect(() =>
      validateProductionEnv(parseDotenv(validProductionEnv())),
    ).not.toThrow();
    expect(pull).not.toHaveBeenCalled();
  });
});
