import { db } from "@/lib/db";

export function expiredMuteWhere(now = new Date()) {
  return {
    status: "MUTED" as const,
    mutedUntil: { lte: now },
  };
}

export async function expireMutedMonitoringIssues() {
  const now = new Date();
  const expired = await db.monitoringIssue.findMany({
    where: expiredMuteWhere(now),
    select: { id: true, status: true },
  });

  let updated = 0;
  for (const issue of expired) {
    const wrote = await db.$transaction(async (tx) => {
      const result = await tx.monitoringIssue.updateMany({
        where: { id: issue.id, ...expiredMuteWhere(now) },
        data: { status: "OPEN", mutedUntil: null },
      });
      if (result.count !== 1) return false;
      await tx.monitoringIssueStatusEvent.create({
        data: {
          issueId: issue.id,
          fromStatus: "MUTED",
          toStatus: "OPEN",
          notes: "Mute expired",
        },
      });
      return true;
    });
    if (!wrote) continue;
    updated += 1;
  }

  return updated;
}
