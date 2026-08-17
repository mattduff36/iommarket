/* @vitest-environment node */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { generateDmPolicyBinaryArtifacts } from "@/scripts/dm-policy-pack-binaries";
import { generateDmPolicyPack } from "@/scripts/generate-dm-policy-pack";

const temporaryDirectories: string[] = [];

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("DM policy pack generator MD-DM-001", () => {
  it("generates a deterministic dated source pack without private data", async () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "iommarket-dm-pack-"));
    temporaryDirectories.push(outputDirectory);

    const first = await generateDmPolicyPack({
      date: "2026-08-17",
      outputDirectory,
      convert: false,
    });
    const firstIndex = readFileSync(
      join(outputDirectory, "index.json"),
      "utf8",
    );
    const second = await generateDmPolicyPack({
      date: "2026-08-17",
      outputDirectory,
      convert: false,
    });

    expect(readFileSync(join(outputDirectory, "index.json"), "utf8")).toBe(
      firstIndex,
    );
    expect(first.conversion).toEqual({
      engine: "skipped",
      docx: "skipped",
      pdf: "skipped",
      zip: "skipped",
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

  it("creates portable DOCX, PDF, and ZIP deliverables without Pandoc", async () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "iommarket-dm-pack-"));
    temporaryDirectories.push(outputDirectory);
    const blocker = join(outputDirectory, "TOOLING-BLOCKER.txt");
    writeFileSync(blocker, "Legacy external tooling blocker.\n", "utf8");

    const result = await generateDmPolicyPack({
      date: "2026-08-17",
      outputDirectory,
    });
    const docx = join(outputDirectory, "dm-policy-pack-2026-08-17.docx");
    const pdf = join(outputDirectory, "dm-policy-pack-2026-08-17.pdf");
    const zip = join(outputDirectory, "dm-policy-pack-2026-08-17.zip");

    expect(result.conversion).toEqual({
      engine: "node",
      docx: "generated",
      pdf: "generated",
      zip: "generated",
    });
    expect(readFileSync(docx).subarray(0, 2).toString()).toBe("PK");
    expect(readFileSync(pdf).subarray(0, 4).toString()).toBe("%PDF");
    expect(readFileSync(zip).subarray(0, 2).toString()).toBe("PK");
    expect(existsSync(blocker)).toBe(false);

    const docxArchive = await JSZip.loadAsync(readFileSync(docx));
    expect(docxArchive.file("word/document.xml")).not.toBeNull();
    const outerArchive = await JSZip.loadAsync(readFileSync(zip));
    expect(
      Object.values(outerArchive.files)
        .filter((entry) => !entry.dir)
        .map((entry) => entry.name)
        .sort(),
    ).toEqual([
      "change-schedule.md",
      "dm-policy-pack-2026-08-17.docx",
      "dm-policy-pack-2026-08-17.pdf",
      "dm-policy-pack.md",
      "index.json",
      "index.md",
      "moderation-matrix.md",
      "redline.md",
      "vehicle-source-register.md",
    ]);

    const firstHashes = [sha256(docx), sha256(pdf), sha256(zip)];
    await generateDmPolicyPack({
      date: "2026-08-17",
      outputDirectory,
    });
    expect([sha256(docx), sha256(pdf), sha256(zip)]).toEqual(firstHashes);
  });

  it("preserves an existing blocker when conversion cannot start", async () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "iommarket-dm-pack-"));
    temporaryDirectories.push(outputDirectory);
    const blocker = join(outputDirectory, "TOOLING-BLOCKER.txt");
    writeFileSync(blocker, "Keep until conversion succeeds.\n", "utf8");

    await expect(
      generateDmPolicyBinaryArtifacts(outputDirectory, "2026-08-17"),
    ).rejects.toThrow("Policy pack source not found");
    expect(readFileSync(blocker, "utf8")).toContain(
      "Keep until conversion succeeds.",
    );
  });
});
