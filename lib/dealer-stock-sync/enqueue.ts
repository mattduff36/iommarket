import { db } from "@/lib/db";
import { dealerSyncBlockReason, isEligibleDealer } from "./eligibility";
import { isFridaySixLondon, londonWeekKey } from "./schedule";
import type { DealerSyncSubject } from "./types";

type EnqueueClient = Pick<typeof db, "dealerStockSourceBinding" | "dealerStockSyncJob">;

export interface EnqueueBinding {
  id: string;
  dealerId: string;
  registryKey: string;
  enabled: boolean;
  verifiedAt: Date | null;
  dealer: DealerSyncSubject;
}

function subject(dealer: {
  isAdminPreview: boolean;
  user: { role: "USER" | "DEALER" | "ADMIN"; disabledAt: Date | null; deletedAt: Date | null };
}): DealerSyncSubject {
  return {
    isAdminPreview: dealer.isAdminPreview,
    role: dealer.user.role,
    disabledAt: dealer.user.disabledAt,
    deletedAt: dealer.user.deletedAt,
  };
}

export function canQueueBinding(binding: EnqueueBinding, mode: "weekly" | "ondemand") {
  if (!binding.verifiedAt) return "unverified";
  if (mode === "weekly" && !binding.enabled) return "weekly-disabled";
  return dealerSyncBlockReason(binding.dealer);
}

export async function enqueueScrapeJob(
  client: EnqueueClient,
  input: {
    binding: EnqueueBinding;
    mode: "weekly" | "ondemand";
    now: Date;
    createdById: string | null;
  },
) {
  const block = canQueueBinding(input.binding, input.mode);
  if (block || !isEligibleDealer(input.binding.dealer)) {
    return { status: "skipped" as const, reason: block ?? "ineligible" };
  }
  const open = await client.dealerStockSyncJob.findFirst({
    where: {
      bindingId: input.binding.id,
      kind: "SCRAPE",
      status: { in: ["QUEUED", "LEASED"] },
    },
    select: { id: true },
  });
  if (open) return { status: "exists" as const, jobId: open.id };
  const weeklyKey = input.mode === "weekly" ? londonWeekKey(input.now) : null;
  try {
    const job = await client.dealerStockSyncJob.create({
      data: {
        kind: "SCRAPE",
        status: "QUEUED",
        bindingId: input.binding.id,
        dealerId: input.binding.dealerId,
        weeklyKey,
        idempotencyKey:
          input.mode === "weekly"
            ? `weekly:${input.binding.id}:${weeklyKey}`
            : `ondemand:${input.binding.id}:${input.now.toISOString()}`,
        payload: { trigger: input.mode, registryKey: input.binding.registryKey },
        createdById: input.createdById,
      },
      select: { id: true },
    });
    return { status: "queued" as const, jobId: job.id };
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
      return { status: "exists" as const, jobId: null };
    }
    throw error;
  }
}

export async function enqueueDueWeeklyScrapes(now = new Date(), client: EnqueueClient = db) {
  if (!isFridaySixLondon(now)) {
    return { due: false, weeklyKey: londonWeekKey(now), queued: 0, skipped: 0 };
  }
  const bindings = await client.dealerStockSourceBinding.findMany({
    where: { enabled: true, verifiedAt: { not: null } },
    select: {
      id: true,
      dealerId: true,
      registryKey: true,
      enabled: true,
      verifiedAt: true,
      dealer: {
        select: {
          isAdminPreview: true,
          user: { select: { role: true, disabledAt: true, deletedAt: true } },
        },
      },
    },
  });
  let queued = 0;
  let skipped = 0;
  for (const binding of bindings) {
    const result = await enqueueScrapeJob(client, {
      binding: { ...binding, dealer: subject(binding.dealer) },
      mode: "weekly",
      now,
      createdById: null,
    });
    if (result.status === "queued") queued += 1;
    else skipped += 1;
  }
  return { due: true, weeklyKey: londonWeekKey(now), queued, skipped };
}

export async function enqueueApplyJob(
  client: Pick<typeof db, "dealerStockSyncJob">,
  input: { bindingId: string; dealerId: string; reportId: string; fingerprint: string; actorId: string },
) {
  const existing = await client.dealerStockSyncJob.findFirst({
    where: { idempotencyKey: `apply:${input.reportId}` },
    select: { id: true, status: true },
  });
  if (existing) return existing;
  return client.dealerStockSyncJob.create({
    data: {
      kind: "APPLY",
      status: "QUEUED",
      bindingId: input.bindingId,
      dealerId: input.dealerId,
      reportId: input.reportId,
      idempotencyKey: `apply:${input.reportId}`,
      payload: { fingerprint: input.fingerprint, reportId: input.reportId },
      createdById: input.actorId,
    },
    select: { id: true, status: true },
  });
}
