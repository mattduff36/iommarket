"use server";

import { getDealerStockSyncAvailability } from "@/lib/deployment/dealer-stock-sync";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { dealerSyncBlockReason } from "@/lib/dealer-stock-sync/eligibility";
import { enqueueApplyJob, enqueueScrapeJob } from "@/lib/dealer-stock-sync/enqueue";
import {
  approveStockReportSchema,
  enqueueDealerScrapeSchema,
  rejectStockReportSchema,
  saveStockBindingSchema,
  setStockBindingEnabledSchema,
} from "@/lib/dealer-stock-sync/schemas";

const SAFE_ERROR = "Website stock sync could not be updated.";

function paths(dealerId: string) {
  revalidatePath("/admin/dealers");
  revalidatePath(`/admin/dealers/${dealerId}/stock-sync`);
}

async function limit(adminId: string) {
  const availability = getDealerStockSyncAvailability();
  if (!availability.enabled) return availability.reason;
  const result = await checkRateLimit(`dealer-stock-sync:${adminId}`, {
    windowMs: 60_000,
    maxRequests: 20,
    policy: "dealer-stock-sync",
  });
  if (!result.allowed) return "Too many stock sync requests. Try again shortly.";
  return null;
}

async function liveDealer(dealerId: string) {
  const dealer = await db.dealerProfile.findUnique({
    where: { id: dealerId },
    select: {
      id: true,
      isAdminPreview: true,
      user: { select: { role: true, disabledAt: true, deletedAt: true } },
    },
  });
  if (!dealer) return { error: "Dealer not found." as const };
  const block = dealerSyncBlockReason({
    isAdminPreview: dealer.isAdminPreview,
    role: dealer.user.role,
    disabledAt: dealer.user.disabledAt,
    deletedAt: dealer.user.deletedAt,
  });
  if (block) return { error: "This dealer account cannot sync website stock." as const };
  return { dealer };
}

export async function saveDealerStockBinding(input: unknown) {
  const admin = await requireRole("ADMIN");
  const limited = await limit(admin.id);
  if (limited) return { error: limited };
  const parsed = saveStockBindingSchema.safeParse(input);
  if (!parsed.success) return { error: "Choose a registry source." };
  const eligible = await liveDealer(parsed.data.dealerId);
  if ("error" in eligible) return eligible;
  try {
    const existing = await db.dealerStockSourceBinding.findUnique({
      where: { dealerId: parsed.data.dealerId },
      select: { id: true, registryKey: true, _count: { select: { identities: true } } },
    });
    if (
      existing &&
      existing.registryKey !== parsed.data.registryKey &&
      existing._count.identities > 0
    ) {
      return { error: "This dealer already has stock identities for another source." };
    }
    const binding = await db.dealerStockSourceBinding.upsert({
      where: { dealerId: parsed.data.dealerId },
      create: {
        dealerId: parsed.data.dealerId,
        registryKey: parsed.data.registryKey,
        enabled: false,
        verifiedAt: new Date(),
        verifiedById: admin.id,
      },
      update: {
        registryKey: parsed.data.registryKey,
        enabled: false,
        verifiedAt: new Date(),
        verifiedById: admin.id,
      },
    });
    await logAdminAction({
      adminId: admin.id,
      action: "DEALER_STOCK_BINDING_SAVE",
      entityType: "DealerStockSourceBinding",
      entityId: binding.id,
      details: { dealerId: parsed.data.dealerId, registryKey: parsed.data.registryKey },
    });
    paths(parsed.data.dealerId);
    return { data: { bindingId: binding.id } };
  } catch {
    return { error: SAFE_ERROR };
  }
}

export async function setDealerStockBindingEnabled(input: unknown) {
  const admin = await requireRole("ADMIN");
  const limited = await limit(admin.id);
  if (limited) return { error: limited };
  const parsed = setStockBindingEnabledSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid stock sync setting." };
  const eligible = await liveDealer(parsed.data.dealerId);
  if ("error" in eligible) return eligible;
  const binding = await db.dealerStockSourceBinding.findUnique({
    where: { dealerId: parsed.data.dealerId },
    select: { id: true, verifiedAt: true },
  });
  if (!binding?.verifiedAt) return { error: "Verify a registry source before enabling weekly sync." };
  await db.dealerStockSourceBinding.update({
    where: { id: binding.id },
    data: { enabled: parsed.data.enabled },
  });
  await logAdminAction({
    adminId: admin.id,
    action: "DEALER_STOCK_BINDING_ENABLED",
    entityType: "DealerStockSourceBinding",
    entityId: binding.id,
    details: { enabled: parsed.data.enabled },
  });
  paths(parsed.data.dealerId);
  return { data: { enabled: parsed.data.enabled } };
}

export async function enqueueDealerStockScrape(input: unknown) {
  const admin = await requireRole("ADMIN");
  const limited = await limit(admin.id);
  if (limited) return { error: limited };
  const parsed = enqueueDealerScrapeSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid dealer." };
  const binding = await db.dealerStockSourceBinding.findUnique({
    where: { dealerId: parsed.data.dealerId },
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
  if (!binding) return { error: "Verify a registry source before queueing a scrape." };
  const result = await enqueueScrapeJob(db, {
    binding: {
      ...binding,
      dealer: {
        isAdminPreview: binding.dealer.isAdminPreview,
        role: binding.dealer.user.role,
        disabledAt: binding.dealer.user.disabledAt,
        deletedAt: binding.dealer.user.deletedAt,
      },
    },
    mode: "ondemand",
    now: new Date(),
    createdById: admin.id,
  });
  if (result.status === "skipped") return { error: "This dealer account cannot sync website stock." };
  paths(parsed.data.dealerId);
  return { data: result };
}

export async function enqueueEnabledDealerStockScrapes() {
  const admin = await requireRole("ADMIN");
  const limited = await limit(admin.id);
  if (limited) return { error: limited };
  const bindings = await db.dealerStockSourceBinding.findMany({
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
  for (const binding of bindings) {
    const result = await enqueueScrapeJob(db, {
      binding: {
        ...binding,
        dealer: {
          isAdminPreview: binding.dealer.isAdminPreview,
          role: binding.dealer.user.role,
          disabledAt: binding.dealer.user.disabledAt,
          deletedAt: binding.dealer.user.deletedAt,
        },
      },
      mode: "ondemand",
      now: new Date(),
      createdById: admin.id,
    });
    if (result.status === "queued") queued += 1;
  }
  revalidatePath("/admin/dealers");
  return { data: { queued } };
}

export async function approveDealerStockReport(input: unknown) {
  const admin = await requireRole("ADMIN");
  const limited = await limit(admin.id);
  if (limited) return { error: limited };
  const parsed = approveStockReportSchema.safeParse(input);
  if (!parsed.success) return { error: "This review is stale." };
  try {
    const outcome = await db.$transaction(async (tx) => {
      const report = await tx.dealerStockSyncReport.findUnique({
        where: { id: parsed.data.reportId },
        select: {
          id: true,
          status: true,
          fingerprint: true,
          bindingId: true,
          dealerId: true,
        },
      });
      if (!report || report.status !== "PENDING_REVIEW" || report.fingerprint !== parsed.data.fingerprint) {
        return { error: "This review is stale." };
      }
      const eligible = await tx.dealerProfile.findUnique({
        where: { id: report.dealerId },
        select: {
          isAdminPreview: true,
          user: { select: { role: true, disabledAt: true, deletedAt: true } },
        },
      });
      if (
        !eligible ||
        dealerSyncBlockReason({
          isAdminPreview: eligible.isAdminPreview,
          role: eligible.user.role,
          disabledAt: eligible.user.disabledAt,
          deletedAt: eligible.user.deletedAt,
        })
      ) {
        return { error: "This dealer account cannot sync website stock." };
      }
      const approved = await tx.dealerStockSyncReport.updateMany({
        where: {
          id: report.id,
          status: "PENDING_REVIEW",
          fingerprint: parsed.data.fingerprint,
        },
        data: { status: "APPROVED", approvedAt: new Date(), approvedById: admin.id },
      });
      if (approved.count !== 1) return { error: "This review is stale." };
      const job = await enqueueApplyJob(tx, {
        bindingId: report.bindingId,
        dealerId: report.dealerId,
        reportId: report.id,
        fingerprint: report.fingerprint,
        actorId: admin.id,
      });
      await logAdminAction(
        {
          adminId: admin.id,
          action: "DEALER_STOCK_REPORT_APPROVE",
          entityType: "DealerStockSyncReport",
          entityId: report.id,
          details: { fingerprint: report.fingerprint, jobId: job.id },
        },
        tx,
      );
      return { data: { jobId: job.id, dealerId: report.dealerId } };
    });
    if ("data" in outcome && outcome.data) paths(outcome.data.dealerId);
    return outcome;
  } catch {
    return { error: SAFE_ERROR };
  }
}

export async function rejectDealerStockReport(input: unknown) {
  const admin = await requireRole("ADMIN");
  const limited = await limit(admin.id);
  if (limited) return { error: limited };
  const parsed = rejectStockReportSchema.safeParse(input);
  if (!parsed.success) return { error: "This review is stale." };
  const report = await db.dealerStockSyncReport.findUnique({
    where: { id: parsed.data.reportId },
    select: { id: true, status: true, dealerId: true },
  });
  if (!report || report.status !== "PENDING_REVIEW") return { error: "This review is stale." };
  const rejected = await db.dealerStockSyncReport.updateMany({
    where: { id: report.id, status: "PENDING_REVIEW" },
    data: { status: "REJECTED" },
  });
  if (rejected.count !== 1) return { error: "This review is stale." };
  await logAdminAction({
    adminId: admin.id,
    action: "DEALER_STOCK_REPORT_REJECT",
    entityType: "DealerStockSyncReport",
    entityId: report.id,
  });
  paths(report.dealerId);
  return { data: { rejected: true } };
}
