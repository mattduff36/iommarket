import { COST_LEDGER_CONFIG_ID } from "@/lib/costs/config";
import { db } from "@/lib/db";

const LOCK_TTL_MS = 30 * 60 * 1000;

export async function withCostSyncLock<T>(
  fn: (holder: string) => Promise<T>,
): Promise<{ acquired: false } | { acquired: true; result: T }> {
  const holder = `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);

  await db.costSyncLock.upsert({
    where: { id: COST_LEDGER_CONFIG_ID },
    update: {},
    create: {
      id: COST_LEDGER_CONFIG_ID,
      holder: "init",
      expiresAt: new Date(0),
    },
  });

  const claimed = await db.costSyncLock.updateMany({
    where: {
      id: COST_LEDGER_CONFIG_ID,
      expiresAt: { lte: now },
    },
    data: { holder, expiresAt },
  });
  if (claimed.count !== 1) {
    return { acquired: false };
  }

  try {
    return { acquired: true, result: await fn(holder) };
  } finally {
    await db.costSyncLock.updateMany({
      where: { id: COST_LEDGER_CONFIG_ID, holder },
      data: { expiresAt: new Date(0) },
    });
  }
}

export async function renewCostSyncLock(holder: string): Promise<boolean> {
  const renewed = await db.costSyncLock.updateMany({
    where: { id: COST_LEDGER_CONFIG_ID, holder },
    data: { expiresAt: new Date(Date.now() + LOCK_TTL_MS) },
  });
  return renewed.count === 1;
}
