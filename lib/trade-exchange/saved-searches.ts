import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type { TradeActor } from "@/lib/trade-exchange/decision";
import { tradeRateLimit } from "@/lib/trade-exchange/limits";
import { tradeSearchSchema } from "@/lib/trade-exchange/validation";

const SAVED_SEARCH_LIMIT = 10;

class TradeWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradeWorkflowError";
  }
}

async function lockSavedSearches(tx: Prisma.TransactionClient, dealerId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`trade-saved:${dealerId}`})::bigint)`;
}

export async function saveTradeSearch(actor: TradeActor, name: string, filters: unknown) {
  if (actor.kind !== "member") return { error: "Not found." };
  const label = name.trim();
  if (label.length < 2 || label.length > 80) return { error: "Name the saved search." };
  const parsed = tradeSearchSchema.safeParse(filters);
  if (!parsed.success) return { error: "Check the filters and try again." };
  const limited = await tradeRateLimit("saved-search", actor.userId, 20, 86_400_000);
  if (limited) return { error: limited };
  try {
    const saved = await db.$transaction(async (tx) => {
      await lockSavedSearches(tx, actor.dealerId);
      const count = await tx.tradeSavedSearch.count({ where: { dealerId: actor.dealerId } });
      if (count >= SAVED_SEARCH_LIMIT) throw new TradeWorkflowError(`Save up to ${SAVED_SEARCH_LIMIT} searches.`);
      return tx.tradeSavedSearch.create({
        data: { dealerId: actor.dealerId, name: label, filters: parsed.data as Prisma.InputJsonValue },
      });
    });
    return { ok: true as const, id: saved.id };
  } catch (error) {
    return { error: error instanceof TradeWorkflowError ? error.message : "The search could not be saved." };
  }
}

export async function deleteTradeSearch(actor: TradeActor, searchId: string) {
  if (actor.kind !== "member") return { error: "Not found." };
  const saved = await db.tradeSavedSearch.findUnique({ where: { id: searchId }, select: { dealerId: true } });
  if (!saved || saved.dealerId !== actor.dealerId) return { error: "Not found." };
  await db.tradeSavedSearch.delete({ where: { id: searchId } });
  return { ok: true as const };
}

export async function listTradeSearches(actor: TradeActor) {
  if (actor.kind !== "member") return [];
  return db.tradeSavedSearch.findMany({
    where: { dealerId: actor.dealerId },
    select: { id: true, name: true, filters: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}
