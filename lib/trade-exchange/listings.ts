import { db } from "@/lib/db";
import type { Prisma, TradeListingStatus } from "@prisma/client";
import { listEligibleTradeDealerIds, sellerIsEligible } from "@/lib/trade-exchange/access";
import { TRADE_CAP_STATUSES, TRADE_LIVE_CAP, tradeExpiryDate } from "@/lib/trade-exchange/constants";
import { canEditTradeListing, canViewTradeListing, type TradeActor } from "@/lib/trade-exchange/decision";
import { canTransitionTradeListing } from "@/lib/trade-exchange/lifecycle";
import { tradeRateLimit } from "@/lib/trade-exchange/limits";
import { parseTradeImport } from "@/lib/trade-exchange/import-csv";
import { listingIsPublishable, tradeListingSchema, tradeSearchSchema, type TradeListingInput } from "@/lib/trade-exchange/validation";
import { tradeSearchWhere } from "@/lib/trade-exchange/search";

const listingViewSelect = {
  id: true,
  dealerId: true,
  status: true,
  make: true,
  model: true,
  year: true,
  mileage: true,
  transmission: true,
  fuel: true,
  conditionSummary: true,
  disclosedDefects: true,
  serviceHistory: true,
  motStatus: true,
  priceType: true,
  pricePence: true,
  vatTreatment: true,
  registrationNumber: true,
  vin: true,
  locationLabel: true,
  notes: true,
  contactPreference: true,
  availabilityNote: true,
  publishedAt: true,
  expiresAt: true,
  createdAt: true,
  dealer: { select: { name: true, phone: true } },
  images: { select: { id: true, width: true, height: true, sortOrder: true }, orderBy: { sortOrder: "asc" as const } },
} satisfies Prisma.TradeListingSelect;

function listingData(input: TradeListingInput) {
  const { writeOff: _writeOff, pricePence, ...data } = input;
  return { ...data, pricePence: input.priceType === "FIXED" ? pricePence ?? null : null };
}

function schemaInputFromRecord(listing: object) {
  const record = listing as Record<string, unknown>;
  return {
    ...record,
    serviceHistory: record.serviceHistory ?? "",
    motStatus: record.motStatus ?? "",
    registrationNumber: record.registrationNumber ?? "",
    vin: record.vin ?? "",
    notes: record.notes ?? "",
    availabilityNote: record.availabilityNote ?? "",
    pricePence: record.pricePence ?? "",
    writeOff: "NONE",
  };
}

class TradeWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradeWorkflowError";
  }
}

function workflowResult(error: unknown, fallback: string) {
  return { error: error instanceof TradeWorkflowError ? error.message : fallback };
}

async function lockTradeLive(tx: Prisma.TransactionClient, dealerId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`trade-live:${dealerId}`})::bigint)`;
}

export async function createTradeDraft(actor: TradeActor, values: unknown) {
  if (actor.kind !== "member") return { error: "Not found." };
  const parsed = tradeListingSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the listing and try again." };
  const limited = await tradeRateLimit("listing-create", actor.userId, 20, 3_600_000);
  if (limited) return { error: limited };
  const listing = await db.$transaction(async (tx) => {
    const created = await tx.tradeListing.create({
      data: { dealerId: actor.dealerId, createdByUserId: actor.userId, status: "DRAFT", ...listingData(parsed.data) },
    });
    await tx.tradeListingEvent.create({
      data: { listingId: created.id, actorUserId: actor.userId, toStatus: "DRAFT", source: "USER" },
    });
    return created;
  });
  return { ok: true as const, id: listing.id };
}

export async function updateTradeListing(actor: TradeActor, listingId: string, values: unknown) {
  if (actor.kind !== "member" && actor.kind !== "admin") return { error: "Not found." };
  const parsed = tradeListingSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the listing and try again." };
  try {
    await db.$transaction(async (tx) => {
      const seed = await tx.tradeListing.findUnique({ where: { id: listingId }, select: { dealerId: true } });
      if (!seed || !canEditTradeListing(actor, seed.dealerId)) throw new TradeWorkflowError("Not found.");
      await lockTradeLive(tx, seed.dealerId);
      const listing = await tx.tradeListing.findUnique({
        where: { id: listingId },
        select: { id: true, dealerId: true, status: true },
      });
      if (!listing || !canEditTradeListing(actor, listing.dealerId)) throw new TradeWorkflowError("Not found.");
      if (listing.status === "REMOVED" || listing.status === "SOLD") throw new TradeWorkflowError("Not found.");
      if (listing.status === "LIVE" || listing.status === "RESERVED") {
        const photos = await tx.tradeListingImage.count({ where: { listingId } });
        const problem = listingIsPublishable(parsed.data, photos);
        if (problem) throw new TradeWorkflowError(problem);
      }
      await tx.tradeListing.update({ where: { id: listingId }, data: listingData(parsed.data) });
    });
  } catch (error) {
    return workflowResult(error, "The listing could not be saved.");
  }
  return { ok: true as const, id: listingId };
}

export async function publishTradeListing(actor: TradeActor, listingId: string, now = new Date()) {
  if (actor.kind !== "member") return { error: "Not found." };
  const limited = await tradeRateLimit("listing-publish", actor.userId, 30, 3_600_000);
  if (limited) return { error: limited };
  try {
    await db.$transaction(async (tx) => {
      await lockTradeLive(tx, actor.dealerId);
      const listing = await tx.tradeListing.findUnique({
        where: { id: listingId },
        include: { images: { select: { id: true } } },
      });
      if (!listing || listing.dealerId !== actor.dealerId || !canTransitionTradeListing(listing.status, "LIVE", "owner")) {
        throw new TradeWorkflowError("Not found.");
      }
      const parsedListing = tradeListingSchema.safeParse(schemaInputFromRecord(listing));
      if (!parsedListing.success) throw new TradeWorkflowError("Check the listing and try again.");
      const problem = listingIsPublishable(parsedListing.data, listing.images.length);
      if (problem) throw new TradeWorkflowError(problem);
      const occupying = listing.status === "LIVE" || listing.status === "RESERVED";
      if (!occupying) {
        const count = await tx.tradeListing.count({
          where: { dealerId: actor.dealerId, status: { in: [...TRADE_CAP_STATUSES] } },
        });
        if (count >= TRADE_LIVE_CAP) throw new TradeWorkflowError(`Trade Exchange allows ${TRADE_LIVE_CAP} live listings.`);
      }
      await tx.tradeListing.update({
        where: { id: listingId },
        data: { status: "LIVE", publishedAt: now, expiresAt: tradeExpiryDate(now), removedAt: null },
      });
      await tx.tradeListingEvent.create({
        data: { listingId, actorUserId: actor.userId, fromStatus: listing.status, toStatus: "LIVE", source: "USER" },
      });
      await tx.tradeMetricEvent.create({ data: { kind: "LISTING_PUBLISHED", dealerId: actor.dealerId } });
    });
  } catch (error) {
    return workflowResult(error, "The listing could not be published.");
  }
  return { ok: true as const };
}

export async function changeTradeListingStatus(input: {
  actor: TradeActor;
  listingId: string;
  to: TradeListingStatus;
  now?: Date;
}) {
  const actor = input.actor;
  if (actor.kind !== "admin" && actor.kind !== "member") return { error: "Not found." };
  const now = input.now ?? new Date();
  if (input.to === "LIVE" && actor.kind === "member") return publishTradeListing(actor, input.listingId, now);
  try {
    await db.$transaction(async (tx) => {
      const seed = await tx.tradeListing.findUnique({ where: { id: input.listingId }, select: { dealerId: true } });
      if (!seed) throw new TradeWorkflowError("Not found.");
      await lockTradeLive(tx, seed.dealerId);
      const listing = await tx.tradeListing.findUnique({
        where: { id: input.listingId },
        include: { images: { select: { id: true } } },
      });
      if (!listing) throw new TradeWorkflowError("Not found.");
      if (actor.kind === "member" && listing.dealerId !== actor.dealerId) throw new TradeWorkflowError("Not found.");
      const actorKind = actor.kind === "admin" ? "admin" : "owner";
      if (!canTransitionTradeListing(listing.status, input.to, actorKind)) throw new TradeWorkflowError("Not found.");
      if (input.to === "LIVE") {
        const parsed = tradeListingSchema.safeParse(schemaInputFromRecord(listing));
        const problem = parsed.success
          ? listingIsPublishable(parsed.data, listing.images.length)
          : parsed.error.issues[0]?.message ?? "The listing is not ready to publish.";
        if (problem) throw new TradeWorkflowError(problem);
        const count = await tx.tradeListing.count({
          where: { dealerId: listing.dealerId, status: { in: [...TRADE_CAP_STATUSES] } },
        });
        if (count >= TRADE_LIVE_CAP) throw new TradeWorkflowError(`Trade Exchange allows ${TRADE_LIVE_CAP} live listings.`);
      }
      const updated = await tx.tradeListing.updateMany({
        where: { id: listing.id, status: listing.status },
        data: {
          status: input.to,
          ...(input.to === "RESERVED" ? { reservedAt: now } : {}),
          ...(input.to === "SOLD" ? { soldAt: now } : {}),
          ...(input.to === "WITHDRAWN" ? { withdrawnAt: now } : {}),
          ...(input.to === "REMOVED" ? { removedAt: now } : {}),
          ...(input.to === "LIVE" ? { publishedAt: now, expiresAt: tradeExpiryDate(now), removedAt: null } : {}),
        },
      });
      if (updated.count !== 1) throw new TradeWorkflowError("Not found.");
      await tx.tradeListingEvent.create({
        data: {
          listingId: listing.id,
          actorUserId: actor.userId,
          fromStatus: listing.status,
          toStatus: input.to,
          source: actorKind === "admin" ? "ADMIN" : "USER",
        },
      });
      if (actorKind === "admin") {
        await tx.adminAuditLog.create({
          data: {
            adminId: actor.userId,
            action: `trade.listing.${input.to.toLowerCase()}`,
            entityType: "TradeListing",
            entityId: listing.id,
            details: { dealerId: listing.dealerId },
          },
        });
      }
      if (input.to === "SOLD") await tx.tradeMetricEvent.create({ data: { kind: "LISTING_SOLD", dealerId: listing.dealerId } });
    });
  } catch (error) {
    return workflowResult(error, "The listing could not be updated.");
  }
  return { ok: true as const };
}

export async function getVisibleTradeListing(actor: TradeActor, listingId: string, now = new Date()) {
  if (actor.kind !== "member" && actor.kind !== "admin") return null;
  const listing = await db.tradeListing.findUnique({ where: { id: listingId }, select: listingViewSelect });
  if (!listing) return null;
  const sellerEligible = actor.kind === "admin" ? true : await sellerIsEligible(listing.dealerId, now);
  if (!canViewTradeListing({
    actor,
    listingDealerId: listing.dealerId,
    status: listing.status,
    sellerEligible,
    expiresAt: listing.expiresAt,
    now,
  })) return null;
  return listing;
}

export const TRADE_BROWSE_PAGE_SIZE = 24;

const TRADE_BROWSE_FILTER_KEYS = [
  "make",
  "model",
  "minYear",
  "maxYear",
  "minMileage",
  "maxMileage",
  "minPriceGbp",
  "maxPriceGbp",
  "transmission",
  "fuel",
  "condition",
  "dealerId",
] as const;

const TRADE_MEMBERSHIP_LABELS: Record<string, string> = {
  NOT_APPLIED: "Not applied",
  PENDING: "In review",
  NEEDS_INFO: "More information needed",
  APPROVED: "Approved",
  REJECTED: "Not approved",
  SUSPENDED: "Suspended",
  REVOKED: "Revoked",
};

const TRADE_LISTING_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_REVIEW: "Awaiting review",
  LIVE: "Live",
  RESERVED: "Reserved",
  SOLD: "Sold",
  WITHDRAWN: "Withdrawn",
  REMOVED: "Removed",
  EXPIRED: "Expired",
};

const TRADE_VAT_LABELS: Record<string, string> = {
  PLUS_VAT: "Plus VAT",
  VAT_INCLUDED: "VAT included",
  NO_VAT: "No VAT",
  NOT_STATED: "VAT not stated",
};

export function sanitizeTradeBrowsePage(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(Math.floor(parsed), 10_000);
}

export function tradeBrowseHref(filters: Record<string, string | undefined>, page: number): string {
  const params = new URLSearchParams();
  for (const key of TRADE_BROWSE_FILTER_KEYS) {
    const value = filters[key]?.trim();
    if (value) params.set(key, value);
  }
  const safePage = sanitizeTradeBrowsePage(page);
  if (safePage > 1) params.set("page", String(safePage));
  const query = params.toString();
  return query ? `/dealer/trade?${query}` : "/dealer/trade";
}

export function tradeMembershipLabel(status: string): string {
  return TRADE_MEMBERSHIP_LABELS[status] ?? "Not applied";
}

export function tradeListingStatusLabel(status: string): string {
  return TRADE_LISTING_STATUS_LABELS[status] ?? "Unavailable";
}

export function tradeVatLabel(treatment: string): string {
  return TRADE_VAT_LABELS[treatment] ?? "VAT not stated";
}

export async function listEligibleTradeSellers(now = new Date()) {
  const ids = await listEligibleTradeDealerIds(now);
  if (ids.length === 0) return [];
  return db.dealerProfile.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function searchLiveTradeListings(actor: TradeActor, values: unknown, page = 1) {
  if (actor.kind !== "member") return { error: "Not found." as const };
  const parsed = tradeSearchSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the filters and try again." };
  const dealerIds = await listEligibleTradeDealerIds();
  const safePage = sanitizeTradeBrowsePage(page);
  const skip = (safePage - 1) * TRADE_BROWSE_PAGE_SIZE;
  const now = new Date();
  const where: Prisma.TradeListingWhereInput = {
    AND: [
      { status: "LIVE", dealerId: { in: dealerIds }, expiresAt: { gt: now } },
      tradeSearchWhere(parsed.data),
    ],
  };
  const [listings, total] = await Promise.all([
    db.tradeListing.findMany({
      where,
      select: listingViewSelect,
      orderBy: { publishedAt: "desc" },
      skip,
      take: TRADE_BROWSE_PAGE_SIZE,
    }),
    db.tradeListing.count({ where }),
  ]);
  return {
    ok: true as const,
    listings,
    total,
    page: safePage,
    pageSize: TRADE_BROWSE_PAGE_SIZE,
    filters: parsed.data,
  };
}

export async function listOwnTradeStock(actor: TradeActor) {
  if (actor.kind !== "member") return [];
  return db.tradeListing.findMany({
    where: { dealerId: actor.dealerId, status: { not: "REMOVED" } },
    select: listingViewSelect,
    orderBy: { updatedAt: "desc" },
  });
}

export async function importTradeDrafts(actor: TradeActor, csv: string) {
  if (actor.kind !== "member") return { error: "Not found." };
  const limited = await tradeRateLimit("import", actor.userId, 3, 86_400_000);
  if (limited) return { error: limited };
  if (csv.length > 200_000) return { error: "The import file is too large." };
  const parsed = parseTradeImport(csv);
  if (parsed.rows.length === 0) return { error: parsed.errors[0]?.message ?? "No rows could be imported.", errors: parsed.errors };
  const created = await db.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const row of parsed.rows) {
      const listing = await tx.tradeListing.create({
        data: { dealerId: actor.dealerId, createdByUserId: actor.userId, status: "DRAFT", ...listingData(row.input) },
      });
      await tx.tradeListingEvent.create({
        data: { listingId: listing.id, actorUserId: actor.userId, toStatus: "DRAFT", source: "USER" },
      });
      ids.push(listing.id);
    }
    await tx.tradeImportBatch.create({
      data: {
        dealerId: actor.dealerId,
        createdByUserId: actor.userId,
        rowCount: parsed.rows.length + parsed.errors.length,
        createdCount: ids.length,
        errorCount: parsed.errors.length,
      },
    });
    await tx.tradeMetricEvent.create({ data: { kind: "LISTING_IMPORTED", dealerId: actor.dealerId } });
    return ids;
  });
  return { ok: true as const, createdCount: created.length, errors: parsed.errors };
}
