export interface HistoricalCursorLine {
  bucketKey: string;
  nativeAmount: string;
  invoiced: boolean;
  policyVersion: string;
}

export interface CursorRepriceProposal {
  reversible: HistoricalCursorLine[];
  blocked: Array<{ line: HistoricalCursorLine; reason: string }>;
  replacements: Array<{ bucketKey: string; nativeAmount: string }>;
  missingDays: string[];
}

const SUBSCRIPTION_SHARE_PREFIX = "cursor:subscription:";

export function proposeCursorReprice(input: {
  existing: readonly HistoricalCursorLine[];
  replacements: readonly { bucketKey: string; nativeAmount: string; day: string }[];
  evidenceDays: readonly string[];
}): CursorRepriceProposal {
  const evidence = new Set(input.evidenceDays);
  const reversible: HistoricalCursorLine[] = [];
  const blocked: CursorRepriceProposal["blocked"] = [];

  for (const line of input.existing) {
    if (!line.bucketKey.startsWith(SUBSCRIPTION_SHARE_PREFIX)) continue;
    const day = line.bucketKey.slice(SUBSCRIPTION_SHARE_PREFIX.length);
    if (line.invoiced) {
      blocked.push({ line, reason: "Invoiced lines stay immutable." });
      continue;
    }
    if (line.policyVersion === "itrader-cursor-60-110-v1") {
      blocked.push({ line, reason: "Line is already on the client policy." });
      continue;
    }
    if (!evidence.has(day)) {
      blocked.push({
        line,
        reason: "No request-level evidence for this day, so it is not repriced.",
      });
      continue;
    }
    reversible.push(line);
  }

  const covered = new Set(
    reversible.map((line) => line.bucketKey.slice(SUBSCRIPTION_SHARE_PREFIX.length)),
  );
  return {
    reversible,
    blocked,
    replacements: input.replacements.filter((line) => covered.has(line.day)),
    missingDays: [...evidence].filter((day) => !covered.has(day) && !input.existing.some((line) => line.bucketKey.endsWith(day))),
  };
}
