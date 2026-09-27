"use server";

import { requireRole } from "@/lib/auth";
import { revalidateCostPages } from "@/actions/admin/revalidate-costs";
import { logAdminAction } from "@/lib/admin/audit";
import {
  CostConfigError,
  getCostOwnerAuthUserId,
  isCostOwner,
  isCostsEnabled,
} from "@/lib/costs/config";
import { resolveLedgerAccess } from "@/lib/costs/ledger-access";
import { assertCanonicalLedgerWriter } from "@/lib/costs/ledger-role";
import { requestRemoteCostRefresh, requestRemoteInvoice } from "@/lib/costs/remote-ledger";
import { deliverCostOutbox } from "@/lib/costs/email";
import { getOrCreateIdentityGbpRate, getOrCreateUsdGbpRate } from "@/lib/costs/fx";
import {
  confirmInvoiceRequest,
  createInvoiceRequest,
  CostInvoiceError,
  safeInvoiceAuditDetails,
} from "@/lib/costs/invoices";
import { applyClassifiedCharge, ensureLedgerConfig, CostLedgerError } from "@/lib/costs/ledger";
import { manualCostSyncMessage } from "@/lib/costs/copy";
import { runCostSync } from "@/lib/costs/sync";
import { runSerializable } from "@/lib/costs/transaction";
import { reportHandledException } from "@/lib/monitoring";
import {
  confirmInvoiceRequestSchema,
  recordManualCostSchema,
  retryCostEmailSchema,
  type ConfirmInvoiceRequestInput,
  type RecordManualCostInput,
  type RetryCostEmailInput,
} from "@/lib/validations/costs";

function costsDisabledError() {
  return { error: "Project cost tracking is not enabled." };
}

function canonicalWriterError(): { error: string } | null {
  try {
    assertCanonicalLedgerWriter();
    return null;
  } catch (error) {
    if (error instanceof CostConfigError) return { error: error.message };
    throw error;
  }
}

async function requireCostOwnerAdmin() {
  const admin = await requireRole("ADMIN");
  if (!isCostOwner(admin.authUserId)) {
    throw new Error("Insufficient permissions");
  }
  return admin;
}

export async function requestProjectInvoice() {
  const admin = await requireRole("ADMIN");
  if (!isCostsEnabled()) return costsDisabledError();
  const access = resolveLedgerAccess();
  if (access.mode === "unavailable") return { error: access.reason };
  if (access.mode === "remote") {
    try {
      const created = await requestRemoteInvoice(access.origin);
      await logAdminAction({
        adminId: admin.id,
        action: "REQUEST_PROJECT_INVOICE",
        entityType: "InvoiceRequest",
        entityId: created.requestId,
        details: { origin: "preview", affectsLiveLedger: true },
      });
      revalidateCostPages();
      return { data: { requestId: created.requestId } };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to request an invoice.";
      return { error: message };
    }
  }
  const writerError = canonicalWriterError();
  if (writerError) return writerError;

  try {
    const created = await createInvoiceRequest({ requesterUserId: admin.id });
    await logAdminAction({
      adminId: admin.id,
      action: "REQUEST_PROJECT_INVOICE",
      entityType: "InvoiceRequest",
      entityId: created.request.id,
      details: safeInvoiceAuditDetails({
        requestId: created.request.id,
        status: "PENDING",
      }),
    });
    try {
      await deliverCostOutbox(created.outboxId);
    } catch {
      // Outbox remains retryable.
    }
    revalidateCostPages();
    return { data: { requestId: created.request.id } };
  } catch (error) {
    if (error instanceof CostInvoiceError) {
      return { error: error.message };
    }
    await reportHandledException({
      error,
      action: "requestProjectInvoice",
      route: "/admin/costs",
    });
    return { error: "Failed to request an invoice." };
  }
}

export async function confirmProjectInvoice(input: ConfirmInvoiceRequestInput) {
  const admin = await requireCostOwnerAdmin();
  if (!isCostsEnabled()) return costsDisabledError();
  const writerError = canonicalWriterError();
  if (writerError) return writerError;
  const parsed = confirmInvoiceRequestSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  try {
    const result = await confirmInvoiceRequest({
      requestId: parsed.data.requestId,
      confirmerUserId: admin.id,
    });
    if (!result.alreadyConfirmed) {
      await logAdminAction({
        adminId: admin.id,
        action: "CONFIRM_PROJECT_INVOICE",
        entityType: "InvoiceRequest",
        entityId: result.request.id,
        details: safeInvoiceAuditDetails({
          requestId: result.request.id,
          status: "CONFIRMED",
        }),
      });
    }
    revalidateCostPages(result.request.id);
    return { data: { requestId: result.request.id, alreadyConfirmed: result.alreadyConfirmed } };
  } catch (error) {
    if (error instanceof CostInvoiceError) {
      return { error: error.message };
    }
    await reportHandledException({
      error,
      action: "confirmProjectInvoice",
      route: "/admin/costs",
    });
    return { error: "Failed to confirm the invoice request." };
  }
}

export async function recordManualProjectCost(input: RecordManualCostInput) {
  const admin = await requireCostOwnerAdmin();
  if (!isCostsEnabled()) return costsDisabledError();
  const writerError = canonicalWriterError();
  if (writerError) return writerError;
  const parsed = recordManualCostSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  try {
    await runSerializable(async (tx) => {
      const config = await ensureLedgerConfig(tx);
      const periodStart = new Date(parsed.data.periodStart);
      const periodEnd = new Date(parsed.data.periodEnd);
      const fx =
        parsed.data.nativeCurrency === "GBP"
          ? await getOrCreateIdentityGbpRate(tx, periodStart)
          : await getOrCreateUsdGbpRate(tx, periodStart);

      await applyClassifiedCharge(tx, {
        sourceKind: "MANUAL",
        bucketKey: `manual:${parsed.data.category}:${parsed.data.externalRef}`,
        checksum: `manual:${parsed.data.category}:${parsed.data.externalRef}:${parsed.data.nativeAmount}:${parsed.data.nativeCurrency}`,
        category: parsed.data.category,
        invoiceability: "INVOICEABLE",
        nativeAmount: parsed.data.nativeAmount,
        nativeCurrency: parsed.data.nativeCurrency,
        rate: fx.rate,
        fxRateSnapshotId: fx.id,
        periodStart,
        periodEnd,
        displayLabel: parsed.data.displayLabel,
        startedAt: config.startedAt,
        metadata:
          parsed.data.category === "DATABASE"
            ? {
                infrastructureMarkupPercent: 20,
                providerInvoiceId: parsed.data.externalRef,
              }
            : { infrastructureMarkupPercent: 20 },
      });
    });

    await logAdminAction({
      adminId: admin.id,
      action: "RECORD_MANUAL_PROJECT_COST",
      entityType: "CostEntry",
      entityId: parsed.data.externalRef,
      details: { category: parsed.data.category },
    });
    revalidateCostPages();
    return { data: { recorded: true } };
  } catch (error) {
    if (error instanceof CostLedgerError) {
      return { error: error.message };
    }
    await reportHandledException({
      error,
      action: "recordManualProjectCost",
      route: "/admin/costs",
    });
    return { error: "Failed to record the cost." };
  }
}

export async function retryProjectCostEmail(input: RetryCostEmailInput) {
  await requireCostOwnerAdmin();
  if (!isCostsEnabled()) return costsDisabledError();
  const writerError = canonicalWriterError();
  if (writerError) return writerError;
  const parsed = retryCostEmailSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  try {
    await deliverCostOutbox(parsed.data.outboxId);
    revalidateCostPages();
    return { data: { retried: true } };
  } catch (error) {
    await reportHandledException({
      error,
      action: "retryProjectCostEmail",
      route: "/admin/costs",
    });
    return { error: "Failed to retry the invoice email." };
  }
}

export async function refreshProviderCosts() {
  await requireCostOwnerAdmin();
  if (!isCostsEnabled()) {
    const message = manualCostSyncMessage({ status: "skipped" });
    return { data: { status: "skipped" as const, message } };
  }
  const access = resolveLedgerAccess();
  if (access.mode === "unavailable") {
    return {
      error: access.reason,
      data: { status: "failed" as const, message: access.reason },
    };
  }
  if (access.mode === "remote") {
    try {
      const result = await requestRemoteCostRefresh(access.origin);
      if (result.status === "failed") {
        return { error: result.message, data: result };
      }
      return { data: result };
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : manualCostSyncMessage({ status: "failed" });
      return { error: message, data: { status: "failed" as const, message } };
    }
  }

  const writerError = canonicalWriterError();
  if (writerError) {
    return {
      error: writerError.error,
      data: { status: "failed" as const, message: writerError.error },
    };
  }

  try {
    const result = await runCostSync({
      trigger: "MANUAL",
      eventId: `manual:${crypto.randomUUID()}`,
    });
    const message = manualCostSyncMessage(result);
    if (result.status === "failed" || result.status === "skipped") {
      return { error: message, data: { ...result, message } };
    }
    return { data: { ...result, message } };
  } catch (error) {
    await reportHandledException({
      error,
      action: "refreshProviderCosts",
      route: "/admin/costs",
    });
    const message = manualCostSyncMessage({ status: "failed" });
    return { error: message, data: { status: "failed" as const, message } };
  }
}

export async function runManualCostSync() {
  await requireCostOwnerAdmin();
  const writerError = canonicalWriterError();
  if (writerError) {
    return {
      error: writerError.error,
      data: { status: "failed" as const, message: writerError.error },
    };
  }
  if (!isCostsEnabled()) {
    return {
      error: costsDisabledError().error,
      data: { status: "skipped" as const, message: manualCostSyncMessage({ status: "skipped" }) },
    };
  }

  try {
    const result = await runCostSync({
      trigger: "MANUAL",
      eventId: `manual:${Date.now()}`,
    });
    revalidateCostPages();
    const message = manualCostSyncMessage(result);
    if (result.status === "succeeded" || result.status === "partial") {
      return { data: { status: result.status, message } };
    }
    return { error: message, data: { status: result.status, message } };
  } catch (error) {
    await reportHandledException({
      error,
      action: "runManualCostSync",
      route: "/admin/costs",
    });
    return {
      error: manualCostSyncMessage({ status: "failed" }),
      data: { status: "failed" as const, message: manualCostSyncMessage({ status: "failed" }) },
    };
  }
}

export async function getCostOwnerConfigured() {
  const admin = await requireRole("ADMIN");
  try {
    return {
      data: {
        isOwner: isCostOwner(admin.authUserId),
        ownerConfigured: Boolean(getCostOwnerAuthUserId()),
      },
    };
  } catch {
    return { data: { isOwner: false, ownerConfigured: false } };
  }
}
