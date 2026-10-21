"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDealerStockSyncAvailability } from "@/lib/deployment/dealer-stock-sync";
import { dealerSyncBlockReason } from "@/lib/dealer-stock-sync/eligibility";
import { fingerprintSnapshot } from "@/lib/dealer-stock-sync/fingerprint";
import { soldListingForNewVehicle } from "@/lib/dealer-stock-sync/plan";
import {
  correctStockReviewActions,
  planAfterCorrection,
  readPlanActions,
  stockReviewCorrectionSchema,
  stockReviewDraft,
  stockReviewLoadSchema,
  type StockReviewCorrectionInput,
} from "@/lib/dealer-stock-sync/review-edit";
import { loadStockSyncSnapshot } from "@/lib/dealer-stock-sync/snapshot";
import type { PlanAction } from "@/lib/dealer-stock-sync/types";
import { validateListingAttributesWithServerPolicy } from "@/lib/listings/listing-ns-policy";
import { stockSyncReason } from "@/lib/dealer-stock-sync/review";
import { checkRateLimit } from "@/lib/rate-limit";

const STALE = "This review is stale. Reload the page and try again.";
const SAFE_ERROR = "Website stock sync could not be updated.";
const VEHICLE_SLUGS = ["car", "van", "motorbike", "motorhome"];

function revalidate(dealerId: string) {
  revalidatePath("/admin/stock-reviews");
  revalidatePath(`/admin/dealers/${dealerId}/stock-sync`);
}

async function limit(adminId: string) {
  const availability = getDealerStockSyncAvailability();
  if (!availability.enabled) return availability.reason ?? SAFE_ERROR;
  const result = await checkRateLimit(`dealer-stock-sync:${adminId}`, {
    windowMs: 60_000,
    maxRequests: 20,
    policy: "dealer-stock-sync",
  });
  return result.allowed ? null : "Too many stock sync requests. Try again shortly.";
}

function blockedAccount(snapshot: NonNullable<Awaited<ReturnType<typeof loadStockSyncSnapshot>>>) {
  return dealerSyncBlockReason({
    isAdminPreview: snapshot.dealer.isAdminPreview,
    role: snapshot.dealer.role as "USER" | "DEALER" | "ADMIN",
    disabledAt: snapshot.dealer.disabledAt,
    deletedAt: snapshot.dealer.deletedAt,
  });
}

async function guardedAdmin() {
  const admin = await requireRole("ADMIN");
  const limited = await limit(admin.id);
  if (limited) return { error: limited };
  return { admin };
}

function slugAttributes(
  definitions: Array<{ id: string; slug: string }>,
  submitted: Record<string, string>,
  sanitized: Array<{ attributeDefinitionId: string; value: string }>,
): { ok: false; error: string } | { ok: true; attributes: Record<string, string> } {
  if (Object.keys(submitted).some((slug) => !definitions.some((definition) => definition.slug === slug))) {
    return { ok: false, error: "Unknown vehicle details cannot be saved." };
  }
  const byId = new Map(sanitized.map((item) => [item.attributeDefinitionId, item.value]));
  const attributes: Record<string, string> = {};
  for (const definition of definitions) {
    const value = byId.get(definition.id);
    if (value) attributes[definition.slug] = value;
  }
  return { ok: true, attributes };
}

export async function loadStockReviewVehicle(input: unknown) {
  const guard = await guardedAdmin();
  if ("error" in guard) return { error: guard.error ?? SAFE_ERROR };
  const parsed = stockReviewLoadSchema.safeParse(input);
  if (!parsed.success) return { error: STALE };
  try {
  const report = await db.dealerStockSyncReport.findUnique({
    where: { id: parsed.data.reportId },
    select: { id: true, status: true, fingerprint: true, dealerId: true, bindingId: true, plan: true },
  });
  const actions = readPlanActions(report?.plan);
  if (!report || report.status !== "PENDING_REVIEW" || report.fingerprint !== parsed.data.fingerprint || !actions) {
    return { error: STALE };
  }
  const action = actions.find((item) => item.sourceIdentityKey === parsed.data.sourceIdentityKey);
  const draft = action ? stockReviewDraft(action) : null;
  if (!action || !draft) return { error: "This vehicle cannot be corrected in the stock review." };
  const snapshot = await loadStockSyncSnapshot(report.dealerId, actions);
  if (!snapshot?.binding.verifiedAt || snapshot.binding.id !== report.bindingId || blockedAccount(snapshot)) {
    return { error: "This dealer account cannot sync website stock." };
  }
  if (fingerprintSnapshot(snapshot) !== report.fingerprint) return { error: STALE };
  const categories = await db.category.findMany({
    where: { active: true, slug: { in: VEHICLE_SLUGS } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      attributeDefinitions: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, slug: true, dataType: true, required: true, options: true },
      },
    },
  });
  return {
    data: {
      draft: {
        ...draft,
        warning: action.kind === "blocked" ? stockSyncReason(action.reason) : draft.warning,
      },
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        attributes: category.attributeDefinitions.map((attribute) => ({
          id: attribute.id,
          name: attribute.name,
          slug: attribute.slug,
          dataType: attribute.dataType,
          required: attribute.required,
          options: typeof attribute.options === "string" ? attribute.options : null,
        })),
      })),
    },
  };
  } catch {
    return { error: SAFE_ERROR };
  }
}

async function validatedAttributes(
  tx: Prisma.TransactionClient,
  input: StockReviewCorrectionInput,
): Promise<{ ok: false; error: string | Record<string, string[]> } | { ok: true; attributes: Record<string, string> }> {
  const category = await tx.category.findFirst({
    where: { slug: input.categorySlug, active: true },
    select: {
      id: true,
      slug: true,
      attributeDefinitions: {
        select: { id: true, slug: true, name: true, dataType: true, required: true, options: true },
      },
    },
  });
  if (!category) return { ok: false, error: "Choose an active vehicle category." };
  const known = slugAttributes(category.attributeDefinitions, input.attributes, []);
  if (!known.ok) return known;
  const submitted = category.attributeDefinitions
    .filter((definition) => input.attributes[definition.slug])
    .map((definition) => ({ attributeDefinitionId: definition.id, value: input.attributes[definition.slug] ?? "" }));
  const validation = validateListingAttributesWithServerPolicy({
    categorySlug: category.slug,
    definitions: category.attributeDefinitions,
    attributes: submitted,
  });
  if (validation.configurationError) return { ok: false, error: validation.configurationError };
  if (Object.keys(validation.fieldErrors).length > 0) return { ok: false, error: validation.fieldErrors };
  return slugAttributes(category.attributeDefinitions, input.attributes, validation.sanitizedAttributes);
}

export async function saveStockReviewVehicle(input: unknown): Promise<
  { error: string | Record<string, string[] | undefined> } | { data: { dealerId: string; fingerprint: string } }
> {
  const guard = await guardedAdmin();
  if ("error" in guard) return { error: guard.error ?? SAFE_ERROR };
  const parsed = stockReviewCorrectionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };
  try {
    const outcome = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "DealerStockSyncReport" WHERE "id" = ${parsed.data.reportId} FOR UPDATE`;
      const report = await tx.dealerStockSyncReport.findUnique({
        where: { id: parsed.data.reportId },
        select: { id: true, status: true, fingerprint: true, dealerId: true, bindingId: true, plan: true },
      });
      const actions = readPlanActions(report?.plan);
      if (!report || report.status !== "PENDING_REVIEW" || report.fingerprint !== parsed.data.fingerprint || !actions) {
        return { error: STALE };
      }
      const snapshot = await loadStockSyncSnapshot(report.dealerId, actions, tx);
      if (
        !snapshot?.binding.verifiedAt ||
        snapshot.binding.id !== report.bindingId ||
        fingerprintSnapshot(snapshot) !== report.fingerprint ||
        blockedAccount(snapshot)
      ) {
        return { error: snapshot && blockedAccount(snapshot) ? "This dealer account cannot sync website stock." : STALE };
      }
      const identities = snapshot.identities.filter((item) => item.sourceIdentityKey === parsed.data.sourceIdentityKey);
      if (identities.length !== 1 || identities[0]?.listingId) {
        return { error: "This website vehicle is already linked or is not a stable new record." };
      }
      const activeJob = await tx.dealerStockSyncJob.findFirst({
        where: {
          bindingId: report.bindingId,
          OR: [
            { status: { in: ["QUEUED", "LEASED"] } },
            { kind: "APPLY", reportId: report.id, status: { notIn: ["FAILED", "CANCELLED"] } },
          ],
        },
        select: { id: true },
      });
      if (activeJob) return { error: "A stock sync job is already queued for this dealer." };
      const region = snapshot.dealer.regionId
        ? await tx.region.findFirst({ where: { id: snapshot.dealer.regionId, active: true }, select: { id: true } })
        : null;
      if (!region) return { error: "The dealer needs an active location before stock can be added." };
      const attributes = await validatedAttributes(tx, parsed.data);
      if (!attributes.ok) return { error: attributes.error };
      const correctedInput = { ...parsed.data, attributes: attributes.attributes };
      const corrected = correctStockReviewActions(actions, correctedInput);
      if (!corrected.ok) return { error: corrected.error };
      if (soldListingForNewVehicle({ title: corrected.corrected.title }, snapshot.listings)) {
        return { error: "This title matches a sold listing and cannot be added." };
      }
      const creates = corrected.actions.filter((action) => action.kind === "create").length;
      if (snapshot.activeListingCount + creates > snapshot.listingCap) {
        return { error: "This correction would exceed the dealer listing limit." };
      }
      const nextFingerprint = fingerprintSnapshot({ ...snapshot, actions: corrected.actions });
      const original = actions.find((action) => action.sourceIdentityKey === parsed.data.sourceIdentityKey) as PlanAction;
      const saved = await tx.dealerStockSyncReport.updateMany({
        where: { id: report.id, status: "PENDING_REVIEW", fingerprint: parsed.data.fingerprint },
        data: {
          status: "PENDING_REVIEW",
          fingerprint: nextFingerprint,
          plan: planAfterCorrection(report.plan, corrected.actions) as unknown as Prisma.InputJsonValue,
        },
      });
      if (saved.count !== 1) return { error: STALE };
      await tx.dealerStockSyncAudit.create({
        data: {
          reportId: report.id,
          actorId: guard.admin.id,
          action: "admin-stock-review-correction",
          before: { fingerprint: report.fingerprint, action: original } as unknown as Prisma.InputJsonValue,
          after: {
            fingerprint: nextFingerprint,
            action: corrected.corrected,
            reason: parsed.data.reason,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      return { data: { dealerId: report.dealerId, fingerprint: nextFingerprint } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
    if ("data" in outcome && outcome.data) revalidate(outcome.data.dealerId);
    return outcome;
  } catch {
    return { error: SAFE_ERROR };
  }
}
