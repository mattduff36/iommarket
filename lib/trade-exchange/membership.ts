import { db } from "@/lib/db";
import type { TradeMembershipStatus } from "@prisma/client";
import { canApplyForTrade, type TradeActor } from "@/lib/trade-exchange/decision";
import { tradeRateLimit } from "@/lib/trade-exchange/limits";
import { notifyTradeApplication } from "@/lib/trade-exchange/notify";
import { detectImageType, isPdf, normalizeRegistration, tradeApplicationSchema, tradeDecisionSchema } from "@/lib/trade-exchange/validation";
import { TRADE_MAX_EVIDENCE_BYTES } from "@/lib/trade-exchange/constants";
import { storeTradeFile } from "@/lib/trade-exchange/storage";

const REAPPLY: TradeMembershipStatus[] = ["NEEDS_INFO", "REJECTED", "REVOKED"];

export async function submitTradeApplication(input: {
  actor: TradeActor;
  accountEmail: string;
  values: unknown;
  evidence?: { bytes: Buffer; fileName: string } | null;
}) {
  if (!canApplyForTrade(input.actor)) return { error: "Not found." };
  const actor = input.actor;
  const parsed = tradeApplicationSchema.safeParse(input.values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the application and try again." };
  const { authorityConfirmed: _authorityConfirmed, ...application } = parsed.data;
  const limited = await tradeRateLimit("application", actor.userId, 5, 86_400_000);
  if (limited) return { error: limited };

  const dealerId = actor.dealerId;
  const registration = normalizeRegistration(parsed.data.registrationIdentifier);
  const duplicate = registration
    ? await db.tradeMembership.findFirst({
        where: { registrationIdentifier: registration, dealerId: { not: dealerId }, status: { not: "REJECTED" } },
        select: { id: true },
      })
    : null;

  let evidence: { fileId: string; filePath: string; fileName: string } | null = null;
  if (input.evidence) {
    if (input.evidence.bytes.length === 0 || input.evidence.bytes.length > TRADE_MAX_EVIDENCE_BYTES) {
      return { error: "Evidence must be a PDF or image under 8 MB." };
    }
    const imageType = detectImageType(input.evidence.bytes);
    const contentType = imageType ?? (isPdf(input.evidence.bytes) ? "application/pdf" : null);
    if (!contentType) return { error: "Evidence must be a PDF, JPG, PNG, or WebP file." };
    const objectId = `evidence-${Date.now().toString(36)}`;
    const stored = await storeTradeFile({
      bytes: input.evidence.bytes,
      contentType,
      kind: "evidence",
      ownerId: dealerId,
      objectId,
    });
    evidence = { fileId: stored.fileId, filePath: stored.filePath, fileName: input.evidence.fileName.slice(0, 120) };
  }

  const existing = await db.tradeMembership.findUnique({ where: { dealerId }, select: { id: true, status: true } });
  if (existing && !REAPPLY.includes(existing.status)) return { error: "Not found." };

  await db.$transaction(async (tx) => {
    const membership = existing
      ? await tx.tradeMembership.update({
          where: { id: existing.id },
          data: {
            ...application,
            registrationIdentifier: registration,
            status: "PENDING",
            duplicateRegistration: Boolean(duplicate),
            submittedAt: new Date(),
            reviewedAt: null,
            reviewedByUserId: null,
            reasonCode: null,
            reviewNote: null,
            ...(evidence
              ? { evidenceFileId: evidence.fileId, evidenceFilePath: evidence.filePath, evidenceFileName: evidence.fileName }
              : {}),
          },
        })
      : await tx.tradeMembership.create({
          data: {
            dealerId,
            ...application,
            registrationIdentifier: registration,
            status: "PENDING",
            duplicateRegistration: Boolean(duplicate),
            ...(evidence
              ? { evidenceFileId: evidence.fileId, evidenceFilePath: evidence.filePath, evidenceFileName: evidence.fileName }
              : {}),
          },
        });
    await tx.tradeMembershipEvent.create({
      data: {
        membershipId: membership.id,
        dealerId,
        actorUserId: actor.userId,
        fromStatus: existing?.status ?? null,
        toStatus: "PENDING",
      },
    });
    await tx.tradeMetricEvent.create({ data: { kind: "APPLICATION_SUBMITTED", dealerId } });
  });
  await notifyTradeApplication(input.accountEmail);
  return { ok: true as const };
}

export async function decideTradeMembership(input: { adminUserId: string; values: unknown }) {
  const parsed = tradeDecisionSchema.safeParse(input.values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the decision and try again." };
  const current = await db.tradeMembership.findUnique({
    where: { id: parsed.data.membershipId },
    select: { id: true, dealerId: true, status: true, dealer: { select: { user: { select: { email: true } } } } },
  });
  if (!current || current.status === parsed.data.decision) return { error: "Not found." };
  await db.$transaction(async (tx) => {
    await tx.tradeMembership.update({
      where: { id: current.id },
      data: {
        status: parsed.data.decision,
        reviewedAt: new Date(),
        reviewedByUserId: input.adminUserId,
        reasonCode: parsed.data.reasonCode ?? null,
        reviewNote: parsed.data.note ?? null,
      },
    });
    await tx.tradeMembershipEvent.create({
      data: {
        membershipId: current.id,
        dealerId: current.dealerId,
        actorUserId: input.adminUserId,
        fromStatus: current.status,
        toStatus: parsed.data.decision,
        reasonCode: parsed.data.reasonCode ?? null,
        note: parsed.data.note ?? null,
      },
    });
    await tx.adminAuditLog.create({
      data: {
        adminId: input.adminUserId,
        action: `trade.membership.${parsed.data.decision.toLowerCase()}`,
        entityType: "TradeMembership",
        entityId: current.id,
        details: { dealerId: current.dealerId, reasonCode: parsed.data.reasonCode ?? null },
      },
    });
    await tx.tradeMetricEvent.create({ data: { kind: "APPLICATION_DECIDED", dealerId: current.dealerId } });
  });
  await notifyTradeApplication(current.dealer.user.email);
  return { ok: true as const };
}
