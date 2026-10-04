import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadFixerrorsDatabase,
  parseFixerrorsDatabaseTarget,
} from "@/scripts/fixerrors/env";
import { PREVIEW_PROJECT_REF, PRODUCTION_PROJECT_REF } from "@/scripts/wipe-preview-marketplace/target";

const CERT = [
  "-----BEGIN CERTIFICATE-----",
  "MIIB",
  "-----END CERTIFICATE-----",
].join("\n");

const productionUrl = `postgresql://postgres:secret@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`;
const previewUrl = `postgresql://postgres.${PREVIEW_PROJECT_REF}:secret@aws-1-eu-west-2.pooler.supabase.com:5432/postgres`;

describe("fixerrors database target", () => {
  const previousCertificate = process.env.SUPABASE_DB_CA_CERT;
  const previousDatabase = process.env.POSTGRES_URL_NON_POOLING;
  let root = "";

  afterEach(() => {
    if (previousCertificate === undefined) delete process.env.SUPABASE_DB_CA_CERT;
    else process.env.SUPABASE_DB_CA_CERT = previousCertificate;
    if (previousDatabase === undefined) delete process.env.POSTGRES_URL_NON_POOLING;
    else process.env.POSTGRES_URL_NON_POOLING = previousDatabase;
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("defaults to production and ignores a preview connection in .env.local", () => {
    root = mkdtempSync(join(tmpdir(), "fixerrors-env-"));
    writeFileSync(join(root, ".env.production"), `POSTGRES_URL_NON_POOLING="${productionUrl}"\n`);
    writeFileSync(join(root, ".env.local"), `POSTGRES_URL_NON_POOLING="${previewUrl}"\nSUPABASE_DB_CA_CERT="${CERT}"\n`);

    expect(parseFixerrorsDatabaseTarget(null)).toBe("production");
    const loaded = loadFixerrorsDatabase("production", root);

    expect(loaded).toMatchObject({ target: "production", envFile: ".env.production", host: `db.${PRODUCTION_PROJECT_REF}.supabase.co` });
    expect(process.env.POSTGRES_URL_NON_POOLING).toBe(productionUrl);
    expect(process.env.SUPABASE_DB_CA_CERT).toBe(CERT);

    writeFileSync(join(root, ".env.production"), `POSTGRES_URL_NON_POOLING="${previewUrl}"\n`);
    expect(() => loadFixerrorsDatabase("production", root)).toThrow(/production database/);
  });

  it("selects preview, staging, or development without allowing the production database", () => {
    root = mkdtempSync(join(tmpdir(), "fixerrors-env-"));
    writeFileSync(join(root, ".env.local"), `POSTGRES_URL_NON_POOLING="${previewUrl}"\n`);
    writeFileSync(join(root, ".env.staging"), `POSTGRES_URL_NON_POOLING="${previewUrl}"\n`);
    writeFileSync(join(root, ".env.development"), `POSTGRES_URL_NON_POOLING="postgresql://postgres:secret@localhost:5432/iommarket"\n`);

    expect(loadFixerrorsDatabase("preview", root).host).toBe("aws-1-eu-west-2.pooler.supabase.com");
    expect(loadFixerrorsDatabase("staging", root).envFile).toBe(".env.staging");
    expect(parseFixerrorsDatabaseTarget("dev")).toBe("development");
    expect(loadFixerrorsDatabase("development", root).host).toBe("localhost");

    writeFileSync(join(root, ".env.development"), `POSTGRES_URL_NON_POOLING="${productionUrl}"\n`);
    expect(() => loadFixerrorsDatabase("development", root)).toThrow(/must not use the production database/);
    expect(() => parseFixerrorsDatabaseTarget("local")).toThrow(/--database/);
  });
});
