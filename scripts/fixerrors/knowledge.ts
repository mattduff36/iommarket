import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface FixerrorsKnowledgeEntry {
  fingerprint: string;
  lane: "fast" | "standard" | "guarded";
  outcome: "fixed";
  summary: string;
  files: string[];
  tests: string[];
  recordedAt: string;
}

export interface FixerrorsKnowledgeStore {
  version: 1;
  entries: FixerrorsKnowledgeEntry[];
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export function sanitizeKnowledgeSummary(summary: string): string {
  const trimmed = summary.trim().slice(0, 240);
  if (!trimmed || EMAIL_RE.test(trimmed)) {
    throw new Error("Knowledge summary must be short and must not contain an email address");
  }
  return trimmed;
}

export function knowledgePath(root = process.cwd()) {
  return resolve(root, "lib", "config", "fixerrors-knowledge.json");
}

export function readKnowledgeStore(root = process.cwd()): FixerrorsKnowledgeStore {
  const parsed = JSON.parse(readFileSync(knowledgePath(root), "utf8")) as FixerrorsKnowledgeStore;
  if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error("Fixerrors knowledge store is invalid");
  }
  return parsed;
}

export function recordKnowledge(entry: Omit<FixerrorsKnowledgeEntry, "recordedAt" | "summary"> & { summary: string }, root = process.cwd()) {
  const store = readKnowledgeStore(root);
  const next: FixerrorsKnowledgeEntry = {
    ...entry,
    summary: sanitizeKnowledgeSummary(entry.summary),
    files: entry.files.map((file) => file.replaceAll("\\", "/")),
    tests: entry.tests,
    recordedAt: new Date().toISOString(),
  };
  const withoutDuplicate = store.entries.filter((existing) => existing.fingerprint !== next.fingerprint);
  const updated: FixerrorsKnowledgeStore = {
    version: 1,
    entries: [...withoutDuplicate, next].slice(-200),
  };
  writeFileSync(knowledgePath(root), `${JSON.stringify(updated, null, 2)}\n`);
  return next;
}
