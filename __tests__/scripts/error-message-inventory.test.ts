import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyCandidate,
  classifyCandidates,
  parseProvenance,
} from "../../scripts/error-messages/classify-candidates";

const root = join(__dirname, "../..");

describe("error candidate inventory rules", () => {
  it("classifies a log line as internal and a public return as displayed", () => {
    expect(classifyCandidate({
      file: "lib/monitoring/capture.ts",
      line: 1,
      source: "console.error(error)",
    }).classification).toBe("internal-only");
    const returned = classifyCandidate({
      file: "actions/listings.ts",
      line: 286,
      source: "return { error: err.message };",
    });
    expect(returned.classification).toBe("displayed");
    expect(returned.semantic_display_verified).toBe(false);
    expect(returned.implementation_status).toBe("listings-b-public-boundary");
    expect(returned.severity_basis).toBe("raw-message-at-public-return");
  });

  it("matches the generated register to the committed provenance", () => {
    const provenance = readFileSync(join(root, "docs/error-messages/candidates.jsonl"), "utf8");
    const rows = parseProvenance(provenance);
    const records = classifyCandidates(rows, root);
    const inventory = readFileSync(join(root, "docs/error-messages/inventory.jsonl"), "utf8").trim().split("\n");
    expect(rows).toHaveLength(3369);
    expect(records).toHaveLength(3369);
    expect(inventory).toHaveLength(3369);
    expect(new Set(records.map((record) => record.file)).size).toBe(421);
    expect(records.every((record) => ["displayed", "internal-only", "duplicate", "irrelevant"].includes(record.classification))).toBe(true);
    expect(records.some((record) => record.journey === "unassigned")).toBe(false);
    expect(records.some((record) => record.semantic_display_verified)).toBe(true);
    expect(records.some((record) => record.trace.includes("image-upload.tsx"))).toBe(true);
    const duplicates = records.filter((record) => record.classification === "duplicate");
    expect(duplicates.every((record) => record.duplicate_of.includes(":"))).toBe(true);
    expect(records.some((record) => record.implementation_status === "deferred-c")).toBe(true);
    expect(records.some((record) => record.implementation_status === "deferred-d")).toBe(true);
    expect(records.some((record) => record.implementation_status === "deferred-c-payment-internals")).toBe(true);
    const stored = inventory.map((line) => JSON.parse(line) as { file: string; line: number; source: string });
    expect(stored.map((record) => `${record.file}:${record.line}:${record.source}`)).toEqual(
      rows.map((row) => `${row.file}:${row.line}:${row.source}`),
    );
    expect(inventory.join("\n")).toBe(records.map((record) => JSON.stringify(record)).join("\n"));
  }, 120_000);
});
