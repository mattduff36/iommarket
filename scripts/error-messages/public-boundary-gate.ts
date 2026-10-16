import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface BoundaryHit {
  file: string;
  line: number;
  snippet: string;
  kind: "raw-message" | "generic-catchall";
}

export interface ReviewedException {
  file: string;
  snippet: string;
  reason: string;
  occurrences: number;
}

const ROOTS = ["actions", "app", "components"];
const RAW_PATTERNS = [
  /\berror\s*:\s*[^,\n]{0,120}\.message\b/,
  /\breturn\s+(?:error|err)\.message\b/,
  /\binstanceof\s+[A-Za-z0-9_]+\s*\?\s*[A-Za-z0-9_]+\.message\b/,
];
const GENERIC = /Please check your details|["'`]Something went wrong[.!]?["'`]|["'`]An unexpected error occurred[.!]?["'`]/;

function walk(dir: string, files: string[]) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full, files);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) files.push(full);
  }
}

export function findPublicBoundaryHits(root: string): BoundaryHit[] {
  const files: string[] = [];
  for (const folder of ROOTS) walk(join(root, folder), files);
  const hits: BoundaryHit[] = [];
  for (const full of files) {
    const file = relative(root, full).replaceAll("\\", "/");
    const source = readFileSync(full, "utf8");
    const lines = source.split(/\r?\n/);
    for (const match of source.matchAll(/\binstanceof\s+[A-Za-z0-9_]+\s*\?\s*[A-Za-z0-9_]+\.message\b/g)) {
      if (!match[0].includes("\n")) continue;
      hits.push({ file, line: source.slice(0, match.index).split("\n").length,
        snippet: match[0].replace(/\s+/g, " "), kind: "raw-message" });
    }
    lines.forEach((line, index) => {
      const snippet = line.trim();
      if (!snippet || snippet.startsWith("//") || snippet.startsWith("*")) return;
      if (RAW_PATTERNS.some((pattern) => pattern.test(snippet))) {
        hits.push({ file, line: index + 1, snippet, kind: "raw-message" });
      }
      if (GENERIC.test(snippet)) {
        hits.push({ file, line: index + 1, snippet, kind: "generic-catchall" });
      }
    });
  }
  return hits;
}

export function uncoveredBoundaryHits(
  hits: readonly BoundaryHit[],
  exceptions: readonly ReviewedException[],
): BoundaryHit[] {
  const used = new Map<ReviewedException, number>();
  return hits.filter((hit) => {
    const exception = exceptions.find((entry) => entry.file === hit.file && entry.snippet === hit.snippet);
    if (!exception) return true;
    const count = (used.get(exception) ?? 0) + 1;
    used.set(exception, count);
    return count > exception.occurrences;
  });
}

export function staleBoundaryExceptions(
  hits: readonly BoundaryHit[],
  exceptions: readonly ReviewedException[],
): ReviewedException[] {
  return exceptions.filter((exception) => !hits.some((hit) =>
    exception.file === hit.file && hit.snippet === exception.snippet,
  ));
}
