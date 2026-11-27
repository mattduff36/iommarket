import { db } from "@/lib/db";
import { dealerSyncBlockReason, isEligibleDealer } from "./eligibility";
import type { DealerSyncSubject } from "./types";

type EnqueueClient = Pick<typeof db, "dealerStockSyncJob">;

export interface EnqueueBinding {
  id: string;
  dealerId: string;
  registryKey: string;
  enabled: boolean;
  verifiedAt: Date | null;
  dealer: DealerSyncSubject;
}

export function canQueueBinding(binding: EnqueueBinding) {
  if (!binding.verifiedAt) return "unverified";
  return dealerSyncBlockReason(binding.dealer);
}

export async function enqueueScrapeJob(
  client: EnqueueClient,
  input: {
    binding: EnqueueBinding;
    now: Date;
    createdById: string;
  },
) {
  const block = canQueueBinding(input.binding);
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
  try {
    const job = await client.dealerStockSyncJob.create({
      data: {
        kind: "SCRAPE",
        status: "QUEUED",
        bindingId: input.binding.id,
        dealerId: input.binding.dealerId,
        idempotencyKey: `ondemand:${input.binding.id}:${input.now.toISOString()}`,
        payload: { trigger: "ondemand", registryKey: input.binding.registryKey },
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

export async function enqueueApplyJob(
  client: Pick<typeof db, "dealerStockSyncJob">,
  input: { bindingId: string; dealerId: string; reportId: string; fingerprint: string; actorId: string; reviewSelection?: boolean },
) {
  const idempotencyKey = input.reviewSelection ? `apply:${input.reportId}:${input.fingerprint}` : `apply:${input.reportId}`;
  const existing = await client.dealerStockSyncJob.findFirst({
    where: { idempotencyKey },
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
      idempotencyKey,
      payload: { fingerprint: input.fingerprint, reportId: input.reportId },
      createdById: input.actorId,
    },
    select: { id: true, status: true },
  });
}
