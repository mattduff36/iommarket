/**
 * Read-only before/after report for moving eligible subscription-share lines
 * onto the 60/110 policy. It reads the local private outbox and configured
 * ledger, then writes only a sanitized report under private/.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { costDb } from "../lib/costs/db";
import {
  normalizeCursorEvents,
  planCursorClientLines,
  type RawCursorUsageEvent,
} from "../lib/costs/cursor-events";
import { proposeCursorReprice } from "../lib/costs/cursor-reconcile";
import { addDecimalStrings } from "../lib/costs/money";

type OutboxRow = {
  payload: string;
  provider_account_ref: string;
};

function outboxPath() {
  if (process.env.CURSOR_USAGE_OUTBOX?.trim()) {
    return process.env.CURSOR_USAGE_OUTBOX.trim();
  }
  const base =
    process.env.LOCALAPPDATA ?? path.join(homedir(), ".local", "share");
  return path.join(base, "iommarket", "cursor-usage.sqlite");
}

function readOutbox() {
  const sqlite = new DatabaseSync(outboxPath(), { readOnly: true });
  try {
    const quality: "complete" | "partial" =
      (
        sqlite
          .prepare("SELECT value FROM meta WHERE key = 'quality'")
          .get() as { value?: string } | undefined
      )?.value === "complete"
        ? "complete"
        : "partial";
    const rows = sqlite
      .prepare(
        `SELECT events.payload, account_events.provider_account_ref
         FROM events
         JOIN account_events ON account_events.id = events.id
         ORDER BY events.id`,
      )
      .all() as unknown as OutboxRow[];
    return { quality, rows };
  } finally {
    sqlite.close();
  }
}

async function main() {
  const outbox = readOutbox();
  const byAccount = new Map<string, RawCursorUsageEvent[]>();
  for (const row of outbox.rows) {
    const current = byAccount.get(row.provider_account_ref) ?? [];
    current.push(JSON.parse(row.payload) as RawCursorUsageEvent);
    byAccount.set(row.provider_account_ref, current);
  }

  const normalized = [...byAccount.entries()].flatMap(([account, events]) => {
    const attribution = new Map(
      events
        .filter((event) => event.conversationId)
        .map((event) => [
          event.conversationId as string,
          { projectId: "itrader", status: "assigned" as const },
        ]),
    );
    return normalizeCursorEvents({
      providerAccountRef: account,
      events,
      attribution,
      sourceQuality: outbox.quality,
    });
  });
  const replacements = planCursorClientLines(normalized).map((line) => ({
    bucketKey: line.bucketKey,
    nativeAmount: line.nativeAmount,
    day: line.periodStart.toISOString().slice(0, 10),
  }));

  const snapshots = await costDb.costSourceSnapshot.findMany({
    where: {
      sourceKind: "CURSOR_USAGE",
      bucketKey: { startsWith: "cursor:subscription:" },
      classified: true,
      quarantined: false,
    },
    orderBy: { revision: "desc" },
    include: {
      entries: {
        where: { kind: "CHARGE" },
        include: {
          reversedBy: { select: { id: true } },
          settlement: { select: { id: true } },
          invoiceLines: { select: { id: true } },
        },
      },
    },
  });
  const latest = new Map<string, (typeof snapshots)[number]>();
  for (const snapshot of snapshots) {
    if (!latest.has(snapshot.bucketKey)) latest.set(snapshot.bucketKey, snapshot);
  }
  const existing = [...latest.values()].flatMap((snapshot) => {
    const charge = snapshot.entries.find((entry) => entry.reversedBy.length === 0);
    if (!charge) return [];
    return [{
      bucketKey: snapshot.bucketKey,
      nativeAmount: charge.nativeAmount.toString(),
      invoiced: Boolean(charge.settlement || charge.invoiceLines.length > 0),
      policyVersion: "gbp-markup-v1",
    }];
  });
  const evidenceDays = [
    ...new Set(normalized.map((event) => event.occurredAt.slice(0, 10))),
  ];
  const proposal = proposeCursorReprice({
    existing,
    replacements,
    evidenceDays,
  });
  const report = {
    generatedAt: new Date().toISOString(),
    appliesChanges: false,
    sourceQuality: outbox.quality,
    before: {
      reversibleLineCount: proposal.reversible.length,
      nativeUsd: addDecimalStrings(
        proposal.reversible.map((line) => line.nativeAmount),
      ),
    },
    after: {
      replacementLineCount: proposal.replacements.length,
      nativeUsd: addDecimalStrings(
        proposal.replacements.map((line) => line.nativeAmount),
      ),
    },
    blocked: proposal.blocked.map(({ line, reason }) => ({
      bucketKey: line.bucketKey,
      reason,
    })),
    missingDays: proposal.missingDays,
  };
  const directory = path.join(process.cwd(), "private");
  mkdirSync(directory, { recursive: true });
  const destination = path.join(
    directory,
    "cost-cursor-reconciliation-report.json",
  );
  writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Wrote read-only reconciliation report: ${destination}\n` +
      `Reversible: ${report.before.reversibleLineCount}; replacements: ${report.after.replacementLineCount}; blocked: ${report.blocked.length}.\n`,
  );
}

main()
  .finally(() => costDb.$disconnect())
  .catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Reconciliation report failed."}\n`,
    );
    process.exitCode = 1;
  });
