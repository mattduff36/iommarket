import { createHash } from "crypto";
import type { MonitoringSource } from "./types";

interface FingerprintInput {
  source: MonitoringSource;
  message: string;
  stack?: string | null;
  route?: string | null;
  action?: string | null;
  component?: string | null;
}

function normalizeMessage(message: string): string {
  return message
    .trim()
    .replace(/\b[a-f0-9]{24,}\b/gi, "<id>")
    .replace(/\d+/g, "<n>")
    .slice(0, 500);
}

function normalizeStack(stack?: string | null): string {
  if (!stack) return "";
  const firstInterestingLine = stack
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.toLowerCase().startsWith("error"));

  return (firstInterestingLine ?? "").slice(0, 500);
}

export function createMonitoringFingerprint(input: FingerprintInput): string {
  const payload = [
    input.source,
    normalizeMessage(input.message),
    normalizeStack(input.stack),
    (input.route ?? "").trim(),
    (input.action ?? "").trim(),
    (input.component ?? "").trim(),
  ].join("|");

  return createHash("sha256").update(payload).digest("hex");
}
