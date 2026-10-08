"use server";
import { createPreviewInvoiceRequest, confirmPreviewInvoiceRequest, recordPreviewManualCost, addPreviewManualCategory, suppressPreviewEmail } from "@/lib/costs/accounts-preview-workflows";

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
import {
  requestRemoteCostRefresh,
  requestRemoteInvoice,
  requestRemoteManualCategory,
  requestRemoteManualCost,
} from "@/lib/costs/remote-ledger";
import { createManualCostCategory } from "@/lib/costs/manual-categories";
import { deliverCostOutbox } from "@/lib/costs/email";
import {
  confirmInvoiceRequest,
  createInvoiceRequest,
  safeInvoiceAuditDetails,
} from "@/lib/costs/invoices";
import { recordManualLedgerCost } from "@/lib/costs/manual-entry";
import { manualCostSyncMessage } from "@/lib/costs/copy";
import { runCostSync } from "@/lib/costs/sync";
import { reportHandledException } from "@/lib/monitoring";
import { journeyUnknownResult } from "@/lib/forms/journey-public-error";
import {
  COST_SETTINGS_UNAVAILABLE,
  costInvoicePublicMessage,
  costLedgerPublicMessage,
  manualCategoryPublicMessage,
} from "@/lib/forms/known-domain-messages";
import {
  confirmInvoiceRequestSchema,
  createManualCostCategorySchema,
  recordManualCostSchema,
  retryCostEmailSchema,
  type ConfirmInvoiceRequestInput,
  type CreateManualCostCategoryInput,
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
    if (error instanceof CostConfigError) return { error: COST_SETTINGS_UNAVAILABLE };
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
  if (access.mode === "accounts-preview") {
    try { const data=await createPreviewInvoiceRequest(admin.id);revalidateCostPages();return {data}; }
    catch { return {error:"The preview invoice request could not be created. Check the Accounts source and pending requests."}; }
  }
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
      return journeyUnknownResult({
        error,
        journey: "dealer-admin",
        action: "requestProjectInvoice",
        route: "/admin/costs",
        kind: "write",
        message: "We couldn't confirm that this invoice request finished. Check the cost pages before trying again.",
        userId: admin.id,
      });
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
    const known = costInvoicePublicMessage(error);
    if (known) return { error: known };
    return journeyUnknownResult({
      error,
      journey: "dealer-admin",
      action: "requestProjectInvoice",
      route: "/admin/costs",
      kind: "write",
      message: "We couldn't confirm that this invoice request finished. Check the cost pages before trying again.",
    });
  }
}

export async function confirmProjectInvoice(input: ConfirmInvoiceRequestInput) {
  const admin = await requireCostOwnerAdmin();
  if (!isCostsEnabled()) return costsDisabledError();
  const parsed = confirmInvoiceRequestSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };
  const access=resolveLedgerAccess();
  if(access.mode==="accounts-preview"){
    try{const data=await confirmPreviewInvoiceRequest(parsed.data.requestId,admin.id);revalidateCostPages(data.requestId);return {data};}
    catch{return {error:"The isolated preview request could not be confirmed."};}
  }
  const writerError = canonicalWriterError();
  if (writerError) return writerError;

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
    const known = costInvoicePublicMessage(error);
    if (known) return { error: known };
    return journeyUnknownResult({
      error,
      journey: "dealer-admin",
      action: "confirmProjectInvoice",
      route: "/admin/costs",
      kind: "destructive",
      message: "We couldn't confirm that this invoice was confirmed. Check the cost pages before trying again.",
    });
  }
}

export async function recordManualProjectCost(input: RecordManualCostInput) {
  const admin = await requireCostOwnerAdmin();
  if (!isCostsEnabled()) return costsDisabledError();
  const parsed = recordManualCostSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const access = resolveLedgerAccess();
  if (access.mode === "unavailable") return { error: access.reason };
  if(access.mode==="accounts-preview"){
    try{await recordPreviewManualCost(parsed.data,admin.id);revalidateCostPages();return {data:{recorded:true}};}
    catch{return {error:"The preview cost could not be recorded. Check the period, category and exchange-rate availability."};}
  }
  if (access.mode === "remote") {
    try {
      await requestRemoteManualCost(access.origin, parsed.data);
      await logAdminAction({
        adminId: admin.id,
        action: "RECORD_MANUAL_PROJECT_COST",
        entityType: "CostEntry",
        entityId: parsed.data.categorySlug,
        details: {
          category: parsed.data.categorySlug,
          origin: "preview",
          affectsLiveLedger: true,
        },
      });
      revalidateCostPages();
      return { data: { recorded: true } };
    } catch (error) {
      return journeyUnknownResult({
        error,
        journey: "dealer-admin",
        action: "recordManualProjectCost",
        route: "/admin/costs",
        kind: "write",
        message: "We couldn't confirm that this cost was recorded. Check the cost pages before trying again.",
        userId: admin.id,
      });
    }
  }

  const writerError = canonicalWriterError();
  if (writerError) return writerError;

  try {
    await recordManualLedgerCost(parsed.data);
    await logAdminAction({
      adminId: admin.id,
      action: "RECORD_MANUAL_PROJECT_COST",
      entityType: "CostEntry",
      entityId: parsed.data.categorySlug,
      details: { category: parsed.data.categorySlug },
    });
    revalidateCostPages();
    return { data: { recorded: true } };
  } catch (error) {
    const known = costLedgerPublicMessage(error);
    if (known) return { error: known };
    return journeyUnknownResult({
      error,
      journey: "dealer-admin",
      action: "recordManualProjectCost",
      route: "/admin/costs",
      kind: "write",
      message: "We couldn't confirm that this cost was recorded. Check the cost pages before trying again.",
    });
  }
}

export async function addManualCostCategory(input: CreateManualCostCategoryInput) {
  const admin = await requireCostOwnerAdmin();
  if (!isCostsEnabled()) return costsDisabledError();
  const parsed = createManualCostCategorySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const access = resolveLedgerAccess();
  if (access.mode === "unavailable") return { error: access.reason };
  if(access.mode==="accounts-preview"){
    try{const data=await addPreviewManualCategory(parsed.data.label);revalidateCostPages();return {data};}
    catch{return {error:"The preview category could not be added. Check its name and existing categories."};}
  }
  if (access.mode !== "remote") {
    const writerError = canonicalWriterError();
    if (writerError) return writerError;
  }
  try {
    const created =
      access.mode === "remote"
        ? await requestRemoteManualCategory(access.origin, parsed.data.label)
        : await createManualCostCategory(parsed.data.label);
    await logAdminAction({
      adminId: admin.id,
      action: "RECORD_MANUAL_PROJECT_COST",
      entityType: "SiteSetting",
      entityId: created.category.slug,
      details: {
        label: created.category.label,
        origin: access.mode === "remote" ? "preview" : "canonical",
      },
    });
    revalidateCostPages();
    return { data: created };
  } catch (error) {
    const known = manualCategoryPublicMessage(error);
    if (known) return { error: known };
    return journeyUnknownResult({
      error,
      journey: "dealer-admin",
      action: "addManualCostCategory",
      route: "/admin/costs",
      kind: "write",
      message: "We couldn't confirm that this category was added. Check the cost pages before trying again.",
    });
  }
}

export async function retryProjectCostEmail(input: RetryCostEmailInput) {
  await requireCostOwnerAdmin();
  if (!isCostsEnabled()) return costsDisabledError();
  const parsed = retryCostEmailSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };
  const access=resolveLedgerAccess();
  if(access.mode==="accounts-preview"){
    try{await suppressPreviewEmail(parsed.data.outboxId);revalidateCostPages();return {data:{retried:true}};}
    catch{return {error:"The preview notification could not be captured. No email was sent."};}
  }
  const writerError = canonicalWriterError();
  if (writerError) return writerError;

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
  if(access.mode==="accounts-preview")return {data:{status:"skipped" as const,message:"Accounts supplies the costs automatically. No provider collection was run."}};
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
        const message = "The cost refresh did not finish. Check the cost pages before trying again.";
        return { error: message, data: { status: "failed" as const, message } };
      }
      return { data: result };
    } catch (error) {
      const failure = await journeyUnknownResult({
        error,
        journey: "dealer-admin",
        action: "refreshProviderCosts",
        route: "/admin/costs",
        kind: "write",
        message: "We couldn't confirm that the cost refresh finished. Check the cost pages before trying again.",
      });
      return { error: failure.error, data: { status: "failed" as const, message: failure.error } };
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
  const access=resolveLedgerAccess();
  if(access.mode==="accounts-preview")return {data:{status:"skipped" as const,message:"Accounts supplies the costs automatically. No provider collection was run."}};
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
