import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const files = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

describe("MapLibre worker assets", () => {
  it("prepares the worker and its relative shared-module dependency", () => {
    execFileSync(process.execPath, ["scripts/prepare-maplibre-worker.mjs"], {
      cwd: root,
      stdio: "pipe",
    });

    for (const file of files) {
      const packaged = readFileSync(
        join(root, "node_modules", "maplibre-gl", "dist", file),
      );
      const prepared = readFileSync(
        join(root, "public", "vendor", "maplibre-gl", file),
      );
      expect(prepared.equals(packaged), `${file} should match the installed package`).toBe(true);
    }
  });
});
