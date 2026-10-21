import { createHash } from "node:crypto";
import { z } from "zod";
import type { InventoryVehicle, PlanAction, ReviewedActionEvidence } from "../../lib/dealer-stock-sync/types";
import { buildTitle, mapReconciledVehicle } from "./map-listing";
import type { CanonicalVehicle, ReconciledVehicle } from "./types";

const SOURCE_CONFLICT_IDS = new Set([
  "2021-mercedes-c220d-amg-line-estate-9g-tronic-auto",
  "2011-dodge-charger-6-1l-v8-srt-coupe-lhd",
]);

const reviewedRowSchema = z.object({
  sourceVehicleId: z.string().trim().min(1).max(180),
  title: z.string().trim().min(1).max(300),
  sourceUrl: z.string().trim().url().nullable().optional(),
  pricePence: z.number().int().nullable(),
  priceCorrected: z.boolean().optional(),
  year: z.number().int().nullable(),
  mileage: z.number().int().nonnegative().nullable(),
  fuel: z.string().nullable().optional(),
  transmission: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  imageUrls: z.array(z.string()),
  failedImageUrls: z.array(z.string()).optional(),
  availability: z.enum(["available", "reserved", "sold", "unknown"]),
  flags: z.array(z.string().trim().min(1)),
});

const reviewedDocumentSchema = z.object({
  capturedAt: z.string().min(1),
  rows: z.array(reviewedRowSchema).min(1),
  coverage: z.array(z.object({
    page: z.number().int(),
    cards: z.number().int().nonnegative(),
    next: z.boolean(),
  })).optional(),
  stockUrl: z.string().optional(),
});

type ReviewedRow = z.infer<typeof reviewedRowSchema>;
type ReviewedDocument = z.infer<typeof reviewedDocumentSchema>;

interface ArchiveRow {
  identityKind?: string;
  vehicle: CanonicalVehicle;
}

export interface ReviewedAdaptation {
  vehicles: InventoryVehicle[];
  evidence: Record<string, ReviewedActionEvidence>;
  capturedAt: string;
  coverageWarning: string | null;
  counts: {
    rows: number;
    importable: number;
    blocked: number;
    sold: number;
    correctedPrices: number;
    reasons: Record<string, number>;
  };
}

export function digestSha256(bytes: Buffer | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function assertExpectedSha256(bytes: Buffer, expected: string) {
  if (!/^[a-f0-9]{64}$/.test(expected) || digestSha256(bytes) !== expected) {
    throw new Error("Reviewed source hash does not match the approval manifest.");
  }
}

export function reviewedIdentityKey(sourceVehicleId: string) {
  return `sourceVehicleId:${sourceVehicleId.trim().toLowerCase().replace(/\s+/g, "")}`;
}

export function explicitStockCategory(registryKey: string, title: string, year: number | null) {
  if (registryKey === "dw-cars") return "car" as const;
  const text = title.toLowerCase();
  if (year === 2024 && text.includes("transporter") && text.includes("camper")) return "motorhome" as const;
  if (year === 2020 && text.includes("crafter") && text.includes("camper")) return "motorhome" as const;
  if (year === 2000 && text.includes("vtr")) return "motorbike" as const;
  if (year === 2019 && /\bt6\b/.test(text)) return "van" as const;
  if (/hi[\s-]*lux/.test(text) || (text.includes("navara") && text.includes("pick"))) return "van" as const;
  return "car" as const;
}

function normalizeTitle(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function titleWithoutLeadingYear(vehicle: CanonicalVehicle) {
  const title = buildTitle(vehicle);
  if (vehicle.year == null) return title;
  const prefix = `${vehicle.year} `;
  return title.startsWith(prefix) ? title.slice(prefix.length) : title;
}

function safePhotoUrls(urls: string[], failed: string[] = []) {
  const rejected = new Set(failed);
  const safe: string[] = [];
  for (const url of urls) {
    if (rejected.has(url) || safe.includes(url)) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) continue;
      safe.push(url);
    } catch {
      continue;
    }
  }
  return safe.slice(0, 20);
}

function readArchive(input: unknown): ArchiveRow[] {
  if (!Array.isArray(input)) throw new Error("Archive vehicles must be a list.");
  return input.map((row, index) => {
    if (!row || typeof row !== "object" || !("vehicle" in row)) {
      throw new Error(`Archive row ${index + 1} is invalid.`);
    }
    const vehicle = (row as { vehicle?: CanonicalVehicle }).vehicle;
    if (!vehicle?.make?.trim() || !vehicle.model?.trim()) {
      throw new Error(`Archive row ${index + 1} is missing make or model.`);
    }
    return { identityKind: (row as { identityKind?: string }).identityKind, vehicle };
  });
}

function coverageWarningFor(registryKey: string, document: ReviewedDocument) {
  if (registryKey === "dw-cars") {
    return "The scan could not confirm that every DW Cars listing was captured. This review adds eligible vehicles only; it will not remove existing listings.";
  }
  const pages = document.coverage ?? [];
  const cards = pages.reduce((sum, page) => sum + page.cards, 0);
  const last = pages[pages.length - 1];
  if (!last || last.next !== false || cards !== document.rows.length) {
    return "Reviewed page coverage does not match the row count. Removal actions are not allowed.";
  }
  return null;
}

function archiveMatches(registryKey: string, row: ReviewedRow, archive: ArchiveRow[]) {
  if (registryKey !== "dw-cars") {
    return archive.filter((item) => item.vehicle.sourceVehicleId === row.sourceVehicleId);
  }
  const title = normalizeTitle(row.title);
  return archive.filter((item) =>
    item.vehicle.year === row.year && normalizeTitle(titleWithoutLeadingYear(item.vehicle)) === title);
}

function titlesAgree(title: string, vehicle: CanonicalVehicle) {
  const reviewed = normalizeTitle(title);
  return reviewed === normalizeTitle(buildTitle(vehicle)) || reviewed === normalizeTitle(titleWithoutLeadingYear(vehicle));
}

function overrideVehicle(row: ReviewedRow, archive: ArchiveRow): CanonicalVehicle {
  return {
    ...archive.vehicle,
    pricePence: row.pricePence,
    year: row.year,
    mileage: row.mileage,
    fuel: row.fuel ?? null,
    transmission: row.transmission ?? null,
    availability: row.availability,
    isPoa: row.pricePence == null || row.flags.includes("price-on-application"),
    imageUrls: safePhotoUrls(row.imageUrls, row.failedImageUrls),
    description: row.description?.trim() || archive.vehicle.description,
    detailUrl: row.sourceUrl ?? archive.vehicle.detailUrl,
  };
}

function blockReason(registryKey: string, row: ReviewedRow, matches: ArchiveRow[], vehicle: CanonicalVehicle | null) {
  if (matches.length === 0) return "unmatched-archive";
  if (matches.length > 1) return "ambiguous-archive";
  if (registryKey === "skillannaylor-car-company" && SOURCE_CONFLICT_IDS.has(row.sourceVehicleId)) return "source-conflict";
  if (row.availability === "sold" || row.flags.includes("sold-exclude-from-live-import")) return "sold-exclude-from-live-import";
  if (row.flags.length > 0) return "review-flag";
  if (row.pricePence == null) return "missing-price";
  if (row.availability !== "available") return "availability-held";
  if (vehicle && !titlesAgree(row.title, vehicle)) return "title-conflict";
  return null;
}

function reconciled(vehicle: CanonicalVehicle, identityKind: string | undefined): ReconciledVehicle {
  return {
    identityKey: reviewedIdentityKey(vehicle.sourceVehicleId ?? ""),
    identityKind: identityKind === "sourceVehicleId" ? "sourceVehicleId" : "sourceVehicleId",
    sources: vehicle.provenance?.sourceKeys ?? [],
    preferredSource: vehicle.sourceKey,
    vehicle,
    priceMismatch: false,
    identityConflict: false,
    conflictReason: null,
    contentHash: "reviewed",
  };
}

function toInventory(input: {
  registryKey: string;
  row: ReviewedRow;
  matches: ArchiveRow[];
  sourceHash: string;
  capturedAt: string;
  coverageWarning: string | null;
}): { vehicle: InventoryVehicle; evidence: ReviewedActionEvidence } {
  const match = input.matches.length === 1 ? input.matches[0] : null;
  const canonical = match ? overrideVehicle(input.row, match) : null;
  const reason = blockReason(input.registryKey, input.row, input.matches, canonical);
  const categorySlug = explicitStockCategory(input.registryKey, input.row.title, input.row.year);
  const photos = safePhotoUrls(input.row.imageUrls, input.row.failedImageUrls);
  const mapped = !reason && canonical ? mapReconciledVehicle(reconciled(canonical, match?.identityKind)) : null;
  const listing = mapped?.listing ?? null;
  const displayTitle = reason === "title-conflict"
    ? input.row.title.slice(0, 120)
    : listing?.title ?? input.row.title.slice(0, 120);
  const provenance = [
    match?.identityKind ?? "sourceVehicleId",
    ...(canonical?.provenance.sourceKeys ?? []),
    "reviewed-snapshot",
  ];
  const evidence: ReviewedActionEvidence = {
    displayTitle,
    fuel: input.row.fuel ?? null,
    transmission: input.row.transmission ?? null,
    flags: input.row.flags,
    pricePence: input.row.pricePence,
    mileage: input.row.mileage,
    year: input.row.year,
    categorySlug,
    sourceUrl: input.row.sourceUrl ?? null,
    safePhotoUrls: photos,
    availability: input.row.availability,
    provenance,
    sourceHash: input.sourceHash,
    capturedAt: input.capturedAt,
    coverageWarning: input.coverageWarning,
    capacityWarning: null,
  };
  const importable = Boolean(listing) && reason == null;
  return {
    evidence,
    vehicle: {
      sourceIdentityKey: reviewedIdentityKey(input.row.sourceVehicleId),
      availability: input.row.availability,
      isPoa: canonical?.isPoa ?? input.row.pricePence == null,
      pricePence: input.row.pricePence,
      mileage: input.row.mileage,
      importable,
      skipReason: importable ? null : reason ?? mapped?.skipReason ?? "not-importable",
      title: importable ? listing?.title ?? displayTitle : displayTitle,
      description: listing?.description ?? null,
      categorySlug: importable ? categorySlug : categorySlug,
      attributes: listing ? { ...listing.attributes } : null,
      ownedImages: [],
      remoteImageCount: photos.length,
      sourceImageUrls: photos,
      sourceUrl: input.row.sourceUrl ?? null,
    },
  };
}

export function adaptReviewedSource(input: {
  registryKey: string;
  reviewed: unknown;
  archive: unknown;
  sourceHash: string;
}): ReviewedAdaptation {
  const document = reviewedDocumentSchema.parse(input.reviewed);
  const archive = readArchive(input.archive);
  const coverageWarning = coverageWarningFor(input.registryKey, document);
  const vehicles: InventoryVehicle[] = [];
  const evidence: Record<string, ReviewedActionEvidence> = {};
  const reasons: Record<string, number> = {};
  for (const row of document.rows) {
    if (Object.hasOwn(evidence, reviewedIdentityKey(row.sourceVehicleId))) {
      throw new Error("Reviewed source contains duplicate vehicle identities.");
    }
    const adapted = toInventory({
      registryKey: input.registryKey,
      row,
      matches: archiveMatches(input.registryKey, row, archive),
      sourceHash: input.sourceHash,
      capturedAt: document.capturedAt,
      coverageWarning,
    });
    vehicles.push(adapted.vehicle);
    evidence[adapted.vehicle.sourceIdentityKey ?? ""] = adapted.evidence;
    if (adapted.vehicle.skipReason) reasons[adapted.vehicle.skipReason] = (reasons[adapted.vehicle.skipReason] ?? 0) + 1;
  }
  const sold = vehicles.filter((vehicle) => vehicle.skipReason === "sold-exclude-from-live-import").length;
  const importable = vehicles.filter((vehicle) => vehicle.importable).length;
  return {
    vehicles,
    evidence,
    capturedAt: document.capturedAt,
    coverageWarning,
    counts: {
      rows: vehicles.length,
      importable,
      blocked: vehicles.length - importable - sold,
      sold,
      correctedPrices: document.rows.filter((row) => row.priceCorrected).length,
      reasons,
    },
  };
}

export function withReviewEvidence(
  actions: PlanAction[],
  evidence: Record<string, ReviewedActionEvidence>,
  capacityWarning: string | null,
): PlanAction[] {
  return actions.map((action) => {
    const review = action.sourceIdentityKey ? evidence[action.sourceIdentityKey] : undefined;
    if (!review) return action;
    return {
      ...action,
      displayTitle: review.displayTitle,
      review: { ...review, capacityWarning },
    };
  });
}
