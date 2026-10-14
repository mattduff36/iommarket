import { db } from "@/lib/db";
import { readTradeFile } from "@/lib/trade-exchange/storage";

export async function readTradeEvidence(adminUserId: string, membershipId: string) {
  const membership = await db.tradeMembership.findUnique({
    where: { id: membershipId },
    select: { id: true, evidenceFilePath: true, evidenceFileName: true },
  });
  if (!membership?.evidenceFilePath) return null;
  await db.tradeEvidenceAccess.create({ data: { membershipId: membership.id, actorUserId: adminUserId } });
  const file = await readTradeFile(membership.evidenceFilePath);
  if (!file) return null;
  const fileName = (membership.evidenceFileName ?? "evidence").replace(/[^A-Za-z0-9._-]/g, "");
  return { bytes: file.bytes, contentType: file.contentType, fileName: fileName || "evidence" };
}
