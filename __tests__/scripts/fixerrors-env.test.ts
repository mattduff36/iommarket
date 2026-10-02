import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadFixerrorsEnv } from "@/scripts/fixerrors/env";

const CERT = [
  "-----BEGIN CERTIFICATE-----",
  "MIIB",
  "-----END CERTIFICATE-----",
].join("\n");

describe("fixerrors env loading", () => {
  const previous = process.env.SUPABASE_DB_CA_CERT;
  let root = "";

  afterEach(() => {
    if (previous === undefined) delete process.env.SUPABASE_DB_CA_CERT;
    else process.env.SUPABASE_DB_CA_CERT = previous;
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("keeps a quoted multiline certificate intact", () => {
    root = mkdtempSync(join(tmpdir(), "fixerrors-env-"));
    writeFileSync(join(root, ".env.local"), `SUPABASE_DB_CA_CERT="${CERT}"\n`);

    loadFixerrorsEnv(root);

    expect(process.env.SUPABASE_DB_CA_CERT).toBe(CERT);
  });
});
