/* @vitest-environment node */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertRuntimeSource, assertRuntimePackage, assertRuntimeLock, verifyRuntimePayload, verifyNoPrivateFiles } from "@/scripts/stock-update-desktop/runtime-boundary.mjs";

const roots: string[] = [];
const source = "scripts/dealer-stock-sync/desktop-access.ts";
const content = 'export const PREVIEW = "https://itrader.dev";\n';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "itrader-runtime-boundary-")); roots.push(root);
  const put = (name: string, value: string) => { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), value); };
  put(source, content); put("package.json", "{}"); put("tsconfig.json", "{}");
  put("package-lock.json", JSON.stringify({ packages: { "": {}, "node_modules/tsx": {} } }));
  return { root, put, hashes: { [source]: createHash("sha256").update(content).digest("hex") } };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("credential-free desktop export boundary", () => {
  it("accepts the reviewed source and actual clean payload", () => {
    assertRuntimeSource(source, content); assertRuntimeSource(source.replaceAll("/", "\\"), content);
    for (const name of ["tsx", "sharp", "@playwright/test"]) assertRuntimePackage(name);
    const f = fixture(); expect(() => verifyRuntimePayload(f.root, f.hashes)).not.toThrow();
  });
  it.each(["lib/db.ts", "lib/media/managed-import.ts", "scripts/dealer-stock-sync/execute-job.ts",
    "scripts/dealer-stock-sync/worker-cli.ts", "scripts/dealer-stock-sync/pc-launcher.ts",
    "scripts/dealer-stock-sync/stock-images.ts", "scripts/dealer-stock-sync/new-unreviewed.ts",
    "../private/.env.local"])("rejects unreviewed/server source %s", name => {
    expect(() => assertRuntimeSource(name, "export {};")).toThrow();
  });
  it.each(["DATABASE_URL", "POSTGRES_URL_NON_POOLING", "IMAGEKIT_PRIVATE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY", "DEALER_STOCK_DESKTOP_CONFIG_JSON", "postgresql://synthetic"])("rejects credential reference %s", name => {
    expect(() => assertRuntimeSource(source, "const forbidden = " + JSON.stringify(name))).toThrow();
  });
  it.each(["pg", "@prisma/client", "imagekit", "cloudinary", "server-only", "dotenv", "@supabase/supabase-js", "next"])("rejects server package %s at both direct and transitive boundaries", name => {
    expect(() => assertRuntimePackage(name)).toThrow();
    expect(() => assertRuntimeLock({ packages: { ["node_modules/other/node_modules/" + name]: {} } })).toThrow();
  });
  it.each([".env", ".env.local", "credentials.json", "preview.bin", "sessions/preview.bin",
    "provisioning/recovery.dpapi", "prisma/schema.prisma", "prisma-build.config.mjs",
    "scripts/dealer-stock-sync/worker-cli.ts", "node_modules/example/.env.local"])("rejects stale or secret payload file %s", name => {
    const f = fixture(); f.put(name, "synthetic");
    expect(() => verifyRuntimePayload(f.root, f.hashes)).toThrow();
  });
  it.each(["runtime/.env.local", "credentials.json", "browsers/session.bin"])("checks private files outside worker: %s", name => {
    const f = fixture(); f.put(name, "synthetic");
    expect(() => verifyNoPrivateFiles(f.root)).toThrow("Forbidden");
  });
  it("rejects changed or absent source instead of emitting a misleading manifest", () => {
    const f = fixture(); f.put(source, content + "// changed");
    expect(() => verifyRuntimePayload(f.root, f.hashes)).toThrow("hash mismatch");
    rmSync(join(f.root, source));
    expect(() => verifyRuntimePayload(f.root, f.hashes)).toThrow("missing");
  });
});
