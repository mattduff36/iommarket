import { z } from "zod";
import type { FingerprintSnapshot } from "./fingerprint";
import { isStockDraftOwnedAction } from "./draft-handoff";
import { foundingManagedSlug, oceanManagedSlug } from "./legacy-identity";
import { sortedStockSet, stableStockContentSignature, stableStockSourceUrl } from "./stock-content-signature";
import type { PlanAction, SyncListing } from "./types";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const sourceSignature = z.object({ version: z.literal(1), digest });
const savedReview = z.object({
  displayTitle: z.string().trim().min(1), description: z.string(), attributes: z.record(z.string(), z.string()),
  fuel: z.string().nullable(), transmission: z.string().nullable(),
  flags: z.array(z.string()), pricePence: z.number().nullable(), mileage: z.number().nullable(), year: z.number().nullable(),
  categorySlug: z.enum(["car", "van", "motorbike", "motorhome"]).nullable(), sourceUrl: z.string().nullable(),
  safePhotoUrls: z.array(z.string()), availability: z.enum(["available", "reserved", "sold", "unknown"]),
  provenance: z.array(z.string()),
});
const envelope = z.object({
  version: z.literal(1), dealerId: z.string(), bindingId: z.string(), registryKey: z.string(),
  entries: z.array(z.object({ sourceIdentityKey: z.string().nullable(), signature: digest.nullable() })),
});
const rejection = z.object({
  actions: z.array(z.object({ sourceIdentityKey: z.string().nullable() }).passthrough()),
  blockedDismissals: z.unknown().optional(),
});

function stableIdentity(key: string | null): key is string {
  return typeof key === "string" && key.length <= 220 &&
    /^(sourceVehicleId|vin|registration|stockReference|detailUrl):\S+$/.test(key) && !/[\u0000-\u001f]/.test(key);
}

function sourceFacts(action: PlanAction) {
  if (action.kind === "blocked" && action.section === "missing") return { presence: "absent" };
  const review = action.review;
  if (!review) return null;
  if (review.sourceSignature !== undefined) {
    const parsed = sourceSignature.safeParse(review.sourceSignature);
    return parsed.success ? { raw: parsed.data } : null;
  }
  const parsed = savedReview.safeParse(review);
  if (!parsed.success || parsed.data.provenance.includes("admin-corrected")) return null;
  const facts = parsed.data;
  return {
    displayTitle: facts.displayTitle, description: facts.description ?? null, attributes: facts.attributes ?? null,
    fuel: facts.fuel ?? null, transmission: facts.transmission ?? null, flags: sortedStockSet(facts.flags),
    pricePence: facts.pricePence, mileage: facts.mileage, year: facts.year, categorySlug: facts.categorySlug,
    sourceUrl: facts.sourceUrl ? stableStockSourceUrl(facts.sourceUrl) : null,
    photos: sortedStockSet(facts.safePhotoUrls.map(stableStockSourceUrl)), availability: facts.availability,
  };
}

function localListingFacts(listing: SyncListing) {
  return {
    id: listing.id, userId: listing.userId ?? null, title: listing.title ?? null, description: listing.description ?? null,
    status: listing.status, price: listing.price, mileage: listing.mileage, featured: listing.featured,
    sold: Boolean(listing.soldAt), lifecycleRevision: listing.lifecycleRevision,
    photoRevision: listing.photoRevision, reviewSourceIdentity: listing.reviewSourceIdentity, slug: listing.slug,
    previewPackId: listing.previewPackId, openRevision: listing.openRevision, stockReviewHeld: listing.stockReviewHeld ?? false,
  };
}

function localContext(snapshot: FingerprintSnapshot, action: PlanAction, key: string) {
  const identities = snapshot.identities.filter(item => item.sourceIdentityKey === key);
  if (identities.length > 1) return null;
  const identity = identities[0];
  const slugs = new Set([foundingManagedSlug(snapshot.binding.registryKey, key), oceanManagedSlug(key)]);
  const duplicateManaged = action.kind === "conflict" && action.reason === "duplicate-managed-listing";
  const related = snapshot.listings.filter(listing =>
    (!duplicateManaged && listing.id === action.listingId) || listing.id === identity?.listingId ||
    listing.reviewSourceIdentity === key || (listing.slug !== null && slugs.has(listing.slug)) ||
    (action.kind === "blocked" && action.reason === "unmapped-existing-stock" &&
      ["LIVE", "APPROVED", "PENDING", "DRAFT"].includes(listing.status) && !listing.reviewSourceIdentity &&
      !snapshot.identities.some(item => item.listingId === listing.id) &&
      !listing.slug?.startsWith(`fd-${snapshot.binding.registryKey}-`) &&
      !(snapshot.binding.registryKey === "ocean-motor-village" && listing.slug?.startsWith("omv-"))));
  if (new Set(related.map(item => item.id)).size !== related.length ||
      related.some(item => item.stockDraft) ||
      snapshot.identities.some(item => item.sourceIdentityKey !== key && item.listingId !== null && related.some(listing => listing.id === item.listingId)) ||
      snapshot.listings.some(item => item.stockDraft?.sourceIdentityKey === key) ||
      (action.listingId && !duplicateManaged && !related.some(item => item.id === action.listingId)) ||
      (identity?.listingId && !related.some(item => item.id === identity.listingId))) return null;
  return {
    userId: snapshot.dealer.userId, regionId: snapshot.dealer.regionId, role: snapshot.dealer.role, isAdminPreview: snapshot.dealer.isAdminPreview,
    disabledAt: snapshot.dealer.disabledAt, deletedAt: snapshot.dealer.deletedAt,
    identity: identity ? { listingId: identity.listingId, baselinePricePence: identity.baselinePricePence, baselineMileage: identity.baselineMileage } : null,
    listings: [...related].sort((a, b) => a.id.localeCompare(b.id)).map(localListingFacts),
  };
}

function dismissalSignature(snapshot: FingerprintSnapshot, action: PlanAction) {
  const key = action.sourceIdentityKey;
  if (!stableIdentity(key) || isStockDraftOwnedAction(action) || !["blocked", "conflict"].includes(action.kind)) return null;
  if (snapshot.actions.filter(item => item.sourceIdentityKey === key).length !== 1) return null;
  if (action.kind !== "blocked" && action.kind !== "conflict") return null;
  if (["duplicate-source", "unstable-identity", "identity-uncertain"].includes(action.reason)) return null;
  const source = sourceFacts(action);
  const local = localContext(snapshot, action, key);
  if (!source || !local) return null;
  return stableStockContentSignature({
    version: 1, dealerId: snapshot.dealer.id, bindingId: snapshot.binding.id, registryKey: snapshot.binding.registryKey,
    sourceIdentityKey: key, kind: action.kind, reason: action.reason,
    section: action.kind === "blocked" ? action.section : null,
    listingId: action.reason === "duplicate-managed-listing" ? null : action.listingId,
    changes: action.kind === "conflict" ? [...action.changes].sort((a, b) => a.field.localeCompare(b.field)) : [],
    source, local,
  });
}

export function blockedDismissalEvidence(snapshot: FingerprintSnapshot, selected: PlanAction[]) {
  return {
    version: 1 as const, dealerId: snapshot.dealer.id, bindingId: snapshot.binding.id, registryKey: snapshot.binding.registryKey,
    entries: selected.filter(action => action.kind === "blocked" || action.kind === "conflict").map(action => ({
      sourceIdentityKey: action.sourceIdentityKey, signature: dismissalSignature(snapshot, action),
    })),
  };
}

/** Audits must be fetched newest first for this exact dealer/binding, with no history/status window. */
export function omitDismissedBlockedActions(snapshot: FingerprintSnapshot, audits: ReadonlyArray<{ before: unknown }>) {
  const latest = new Map<string, string | null>();
  for (const audit of audits) {
    const before = rejection.safeParse(audit.before);
    // An unidentifiable newer rejection is a barrier, never permission to reuse older evidence.
    if (!before.success) break;
    const evidence = envelope.safeParse(before.data.blockedDismissals);
    const scoped = evidence.success && evidence.data.dealerId === snapshot.dealer.id &&
      evidence.data.bindingId === snapshot.binding.id && evidence.data.registryKey === snapshot.binding.registryKey;
    for (const action of before.data.actions) {
      const key = action.sourceIdentityKey;
      if (!key || latest.has(key)) continue;
      const entries = scoped ? evidence.data.entries.filter(item => item.sourceIdentityKey === key) : [];
      const unique = before.data.actions.filter(item => item.sourceIdentityKey === key).length === 1;
      latest.set(key, unique && entries.length === 1 ? entries[0]!.signature : null);
    }
  }
  return snapshot.actions.filter(action => {
    const previous = action.sourceIdentityKey ? latest.get(action.sourceIdentityKey) : null;
    return !previous || dismissalSignature(snapshot, action) !== previous;
  });
}
