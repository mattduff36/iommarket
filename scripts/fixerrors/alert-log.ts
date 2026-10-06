import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { redactFreeText } from "@/lib/monitoring/redact";
import { normalizeMessage } from "./analysis";
import type { FixerrorsDecision } from "./decision";
import { readKnowledgeStore } from "./knowledge";

export type AlertLogOutcome = "seen" | "fixed" | "recurred";

export interface AlertLogEvent {
  at: string;
  fingerprint: string;
  normalizedMessage: string;
  source: string;
  route: string | null;
  action: string | null;
  severity: string;
  occurrences: number;
  lastSeenAt: string;
  outcome: AlertLogOutcome;
  summary?: string;
  files?: string[];
}

export interface AlertLogSubject {
  id: string;
  fingerprint: string;
  title: string;
  sampleMessage: string;
  source: string;
  sampleRoute: string | null;
  sampleAction: string | null;
  severity: string;
  occurrences: number;
  lastSeenAt: string;
}

export interface AlertRecall {
  issueId: string;
  earlierCount: number;
  fixFailed: boolean;
  note: string;
}

export function alertLogPath(root = process.cwd()) {
  return resolve(root, "private", "fixerrors", "alert-log.jsonl");
}

export function readAlertLog(root = process.cwd()): AlertLogEvent[] {
  const path = alertLogPath(root);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").flatMap((line) => parseAlertLogLine(line));
}

export function loadAlertHistory(root = process.cwd()): AlertLogEvent[] {
  let recorded: AlertLogEvent[] = [];
  try {
    recorded = readKnowledgeStore(root).entries.flatMap((entry) =>
      (entry.issueFingerprints ?? []).map((fingerprint) => ({
        at: entry.recordedAt,
        fingerprint,
        normalizedMessage: "",
        source: "",
        route: null,
        action: null,
        severity: "",
        occurrences: 0,
        lastSeenAt: entry.recordedAt,
        outcome: "fixed" as const,
        summary: entry.summary,
        files: entry.files,
      })),
    );
  } catch {
    recorded = [];
  }
  return [...recorded, ...readAlertLog(root)];
}

export function appendAlertLog(events: AlertLogEvent[], root = process.cwd()) {
  if (events.length === 0) return;
  const path = alertLogPath(root);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

export function newSeenEvents(
  issues: AlertLogSubject[],
  existing: AlertLogEvent[],
  now = new Date(),
): AlertLogEvent[] {
  return issues.flatMap((issue) => {
    const normalizedMessage = loggedMessage(issue);
    const prior = existing.filter((event) => event.fingerprint === issue.fingerprint && event.outcome === "seen");
    const latest = prior.at(-1);
    if (
      latest
      && latest.lastSeenAt === issue.lastSeenAt
      && latest.occurrences === issue.occurrences
      && latest.normalizedMessage === normalizedMessage
    ) {
      return [];
    }
    return [seenEvent(issue, normalizedMessage, now)];
  });
}

export function recallOpenIssues(issues: AlertLogSubject[], events: AlertLogEvent[]): AlertRecall[] {
  return issues.map((issue) => recallIssue(issue, events));
}

export function applyAlertHistory(
  decisions: FixerrorsDecision[],
  recalls: AlertRecall[],
): FixerrorsDecision[] {
  return decisions.map((decision) => {
    const failed = decision.issueIds.some((issueId) => recalls.find((recall) => recall.issueId === issueId)?.fixFailed);
    if (!failed) return decision;
    return {
      ...decision,
      action: "needs-person",
      blockReason: "This came back after a previous fix. Do not repeat that change; investigate it again.",
    };
  });
}

export function renderAlertHistory(recalls: AlertRecall[]): string[] {
  const lines = [
    "## What we already know",
    "",
    "Read this before choosing a fix. It comes from private/fixerrors/alert-log.jsonl and the committed fix history.",
    "If an earlier fix did not hold, do not repeat that change.",
    "",
  ];
  if (recalls.length === 0) {
    lines.push("No open errors to compare yet.");
    return lines;
  }
  for (const recall of recalls) {
    lines.push(`### ${recall.issueId}`, "", recall.note, "");
  }
  return lines;
}

function recallIssue(issue: AlertLogSubject, events: AlertLogEvent[]): AlertRecall {
  const message = loggedMessage(issue);
  const same = events.filter((event) => event.fingerprint === issue.fingerprint || (message.length > 0 && event.normalizedMessage === message));
  const earlierCount = same.filter((event) => event.outcome === "seen").length;
  const previousFix = latest(same, "fixed");
  const recurred = latest(same, "recurred");
  const fixFailed = previousFix != null && (
    new Date(issue.lastSeenAt).getTime() > new Date(previousFix.at).getTime()
    || (recurred != null && new Date(recurred.at).getTime() >= new Date(previousFix.at).getTime())
  );
  const similarFix = previousFix ? null : latestSimilarFix(message, issue.fingerprint, events);
  return {
    issueId: issue.id,
    earlierCount,
    fixFailed,
    note: recallNote({ earlierCount, fixFailed, previousFix, similarFix }),
  };
}

function recallNote(input: {
  earlierCount: number;
  fixFailed: boolean;
  previousFix: AlertLogEvent | null;
  similarFix: AlertLogEvent | null;
}): string {
  if (input.fixFailed && input.previousFix) {
    return `This is the same error as one recorded on ${day(input.previousFix.at)}. The earlier fix was: ${fixText(input.previousFix)} That fix did not hold. Do not repeat it. Investigate the cause again.`;
  }
  if (input.previousFix) {
    return `A fix was recorded on ${day(input.previousFix.at)}: ${fixText(input.previousFix)} The error has not come back since that fix.`;
  }
  if (input.similarFix) {
    return `A similar error was fixed on ${day(input.similarFix.at)}: ${fixText(input.similarFix)} Check whether that approach still applies before writing a new one.`;
  }
  if (input.earlierCount > 0) {
    return `This error was logged ${input.earlierCount} time${input.earlierCount === 1 ? "" : "s"} before, and no fix has been recorded yet.`;
  }
  return "No earlier record of this error. This run adds it to the alert log.";
}

function latestSimilarFix(message: string, fingerprint: string, events: AlertLogEvent[]): AlertLogEvent | null {
  const similar = events.filter((event) =>
    event.outcome === "fixed"
    && event.fingerprint !== fingerprint
    && messagesSimilar(message, event.normalizedMessage),
  );
  return similar.at(-1) ?? null;
}

function messagesSimilar(left: string, right: string): boolean {
  if (!left || !right || left === right) return false;
  const leftTokens = new Set(tokens(left));
  const rightTokens = new Set(tokens(right));
  if (leftTokens.size < 4 || rightTokens.size < 4) return false;
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  const union = leftTokens.size + rightTokens.size - shared;
  return union > 0 && shared / union >= 0.6;
}

function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/u).filter((token) => token.length > 2);
}

function latest(events: AlertLogEvent[], outcome: AlertLogOutcome): AlertLogEvent | null {
  return events.filter((event) => event.outcome === outcome).at(-1) ?? null;
}

function fixText(event: AlertLogEvent): string {
  const summary = event.summary?.trim() || "a code change";
  const files = (event.files ?? []).slice(0, 5);
  return files.length > 0 ? `${summary} Files: ${files.join(", ")}.` : `${summary}.`;
}

function day(value: string): string {
  return value.slice(0, 10);
}

function loggedMessage(issue: AlertLogSubject): string {
  return normalizeMessage(redactFreeText(issue.sampleMessage || issue.title));
}

function seenEvent(issue: AlertLogSubject, normalizedMessage: string, now: Date): AlertLogEvent {
  return {
    at: now.toISOString(),
    fingerprint: issue.fingerprint,
    normalizedMessage,
    source: issue.source,
    route: issue.sampleRoute,
    action: issue.sampleAction,
    severity: issue.severity,
    occurrences: issue.occurrences,
    lastSeenAt: issue.lastSeenAt,
    outcome: "seen",
  };
}

function parseAlertLogLine(line: string): AlertLogEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as Partial<AlertLogEvent>;
    if (typeof parsed.fingerprint !== "string" || (parsed.outcome !== "seen" && parsed.outcome !== "fixed" && parsed.outcome !== "recurred")) {
      return [];
    }
    return [{
      at: typeof parsed.at === "string" ? parsed.at : "",
      fingerprint: parsed.fingerprint,
      normalizedMessage: typeof parsed.normalizedMessage === "string" ? parsed.normalizedMessage : "",
      source: typeof parsed.source === "string" ? parsed.source : "",
      route: typeof parsed.route === "string" ? parsed.route : null,
      action: typeof parsed.action === "string" ? parsed.action : null,
      severity: typeof parsed.severity === "string" ? parsed.severity : "",
      occurrences: typeof parsed.occurrences === "number" ? parsed.occurrences : 0,
      lastSeenAt: typeof parsed.lastSeenAt === "string" ? parsed.lastSeenAt : "",
      outcome: parsed.outcome,
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
      files: Array.isArray(parsed.files) ? parsed.files.filter((file): file is string => typeof file === "string") : undefined,
    }];
  } catch {
    return [];
  }
}
