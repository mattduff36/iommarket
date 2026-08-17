"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin/audit";
import {
  getCostOwnerAuthUserId,
  isCostOwner,
  isCostsEnabled,
} from "@/lib/costs/config";
import { deliverCostOutbox } from "@/lib/costs/email";
import { getOrCreateIdentityGbpRate, getOrCreateUsdGbpRate } from "@/lib/costs/fx";
import {
  confirmInvoiceRequest,
  createInvoiceRequest,
  CostInvoiceError,
  safeInvoiceAuditDetails,
} from "@/lib/costs/invoices";
import { applyClassifiedCharge, ensureLedgerConfig, CostLedgerError } from "@/lib/costs/ledger";
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
    revalidatePath("/admin/costs");
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
    revalidatePath("/admin/costs");
    revalidatePath(`/admin/costs/confirm/${result.request.id}`);
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
      });
    });

    await logAdminAction({
      adminId: admin.id,
      action: "RECORD_MANUAL_PROJECT_COST",
      entityType: "CostEntry",
      entityId: parsed.data.externalRef,
      details: { category: parsed.data.category },
    });
    revalidatePath("/admin/costs");
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
  const parsed = retryCostEmailSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  try {
    await deliverCostOutbox(parsed.data.outboxId);
    revalidatePath("/admin/costs");
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

export async function runManualCostSync() {
  await requireCostOwnerAdmin();
  if (!isCostsEnabled()) return costsDisabledError();

  try {
    const result = await runCostSync({
      trigger: "MANUAL",
      eventId: `manual:${Date.now()}`,
    });
    revalidatePath("/admin/costs");
    return { data: { status: result.status } };
  } catch (error) {
    await reportHandledException({
      error,
      action: "runManualCostSync",
      route: "/admin/costs",
    });
    return { error: "Failed to synchronize costs." };
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
