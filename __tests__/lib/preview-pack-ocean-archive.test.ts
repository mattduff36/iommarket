import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteOceanArchiveDealerDirs,
  listOceanArchiveDealerDirs,
} from "@/lib/preview-packs/cleanup-ocean-archive";

const roots: string[] = [];

function makeArchive() {
  const root = join(tmpdir(), `preview-ocean-archive-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const run = join(root, "runs", "2026-08-22T20-00-00-000Z");
  mkdirSync(join(run, "athol-garage"), { recursive: true });
  mkdirSync(join(run, "ocean-motor-village"), { recursive: true });
  mkdirSync(join(run, "ocean-ford"), { recursive: true });
  writeFileSync(join(run, "athol-garage", "manifest.json"), "{}", "utf8");
  writeFileSync(join(run, "ocean-motor-village", "manifest.json"), "{}", "utf8");
  writeFileSync(join(run, "ocean-ford", "manifest.json"), "{}", "utf8");
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("ocean archive cleanup", () => {
  it("lists only Ocean dealer folders and leaves other archives in place", () => {
    const root = makeArchive();
    const listed = listOceanArchiveDealerDirs(root);
    expect(listed.some((dir) => dir.includes("ocean-motor-village"))).toBe(false);
    expect(listed.some((dir) => dir.includes("ocean-ford"))).toBe(true);
    expect(listed.some((dir) => dir.includes("athol-garage"))).toBe(false);
    const deleted = deleteOceanArchiveDealerDirs(root);
    expect(deleted.length).toBe(1);
    expect(listOceanArchiveDealerDirs(root)).toEqual([]);
  });

  it("never mutates database listings, so the 41 Ocean LIVE rows stay", () => {
    const cleanup = readFileSync("lib/preview-packs/cleanup-ocean-archive.ts", "utf8");
    const materialize = readFileSync("lib/preview-packs/materialize.ts", "utf8");
    expect(cleanup).not.toMatch(/prisma|DATABASE_URL|listing\.(update|delete|updateMany|deleteMany)/i);
    expect(materialize).not.toMatch(/listing\.(update|delete|updateMany|deleteMany)/);
    expect(materialize).toContain('status: "ADMIN_PREVIEW"');
    expect(materialize).toContain("assertNotOceanDealerProfile");
  });
});
