import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findPublicBoundaryHits,
  staleBoundaryExceptions,
  uncoveredBoundaryHits,
  type ReviewedException,
} from "../../scripts/error-messages/public-boundary-gate";

const root = join(__dirname, "../..");

describe("public boundary gate", () => {
  it("rejects new raw public messages that are not an explicit reviewed exception", () => {
    const exceptions = JSON.parse(readFileSync(
      join(root, "scripts/error-messages/reviewed-public-exceptions.json"),
      "utf8",
    )) as ReviewedException[];
    const hits = findPublicBoundaryHits(root);
    const uncovered = uncoveredBoundaryHits(hits, exceptions);
    const stale = staleBoundaryExceptions(hits, exceptions);
    expect(uncovered, uncovered.map((hit) => `${hit.file}:${hit.line} ${hit.snippet}`).join("\n")).toEqual([]);
    expect(stale, stale.map((item) => `${item.file} ${item.snippet}`).join("\n")).toEqual([]);
    expect(exceptions.every((item) => item.reason.trim().length > 10)).toBe(true);
  });
});
