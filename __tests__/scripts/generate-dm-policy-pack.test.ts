/* @vitest-environment node */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateDmPolicyPack } from "@/scripts/generate-dm-policy-pack";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("DM policy pack generator MD-DM-001", () => {
  it("generates a deterministic dated source pack without private data", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "iommarket-dm-pack-"));
    temporaryDirectories.push(outputDirectory);

    const first = generateDmPolicyPack({
      date: "2026-08-17",
      outputDirectory,
      convert: false,
    });
    const firstIndex = readFileSync(
      join(outputDirectory, "index.json"),
      "utf8",
    );
    const second = generateDmPolicyPack({
      date: "2026-08-17",
      outputDirectory,
      convert: false,
    });

    expect(readFileSync(join(outputDirectory, "index.json"), "utf8")).toBe(
      firstIndex,
    );
    expect(first.conversion).toEqual({
      pandocAvailable: false,
      docx: "skipped",
      pdf: "skipped",
    });
    expect(second.files.map((file) => file.split(/[\\/]/).pop())).toEqual(
      expect.arrayContaining([
        "index.json",
        "index.md",
        "redline.md",
        "change-schedule.md",
        "moderation-matrix.md",
        "vehicle-source-register.md",
        "dm-policy-pack.md",
      ]),
    );
    expect(firstIndex).toContain(
      "Private working pack — not legal approval",
    );
  });
});
