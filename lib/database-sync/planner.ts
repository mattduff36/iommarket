import { createHash } from "node:crypto";
import { NATURAL_IDENTITIES, PRIMARY_KEYS, selectAllowedColumns, stringValue } from "./policy";
import { SYNC_TABLES } from "./types";
import type {
  DatabaseSyncPlan,
  PlanDatabaseSyncInput,
  SyncDataset,
  SyncJson,
  SyncOperation,
  SyncRow,
  SyncTable,
} from "./types";

const EMPTY_COUNTS = { insert: 0, update: 0, delete: 0, preserve: 0, skip: 0 } as const;
const WRITE_ORDER: readonly SyncTable[] = [
  "Region", "Category", "AttributeDefinition", "VehicleMake", "VehicleModel",
  "VehicleModelAlias", "User", "DealerProfile", "Listing", "ListingImage",
  "ListingAttributeValue", "ContentPage",
];
const DELETE_ORDER: readonly SyncTable[] = [
  "ListingAttributeValue", "ListingImage", "Listing", "DealerProfile", "ContentPage",
];
const NEVER_DELETE = new Set<SyncTable>([
  "Region", "Category", "AttributeDefinition", "VehicleMake", "VehicleModel",
  "VehicleModelAlias", "User",
]);

const tableIdentity = new Map(NATURAL_IDENTITIES.map((identity) => [identity.table, identity.key]));

function canonical(value: SyncJson): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const fields = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`);
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function snapshotHash(dataset: SyncDataset): string {
  const normalized = Object.fromEntries(SYNC_TABLES.map((table) => [
    table,
    dataset[table].map((row) => planRow(table, row))
      .sort((a, b) => (PRIMARY_KEYS[table](a) ?? "").localeCompare(PRIMARY_KEYS[table](b) ?? "")),
  ])) as unknown as SyncJson;
  return createHash("sha256").update(canonical(normalized)).digest("hex");
}

function id(row: SyncRow): string | null {
  return stringValue(row.id);
}

function isTruthy(row: SyncRow, field: string): boolean {
  return row[field] === true;
}

function same(left: SyncRow, right: SyncRow): boolean {
  return canonical(left as SyncJson) === canonical(right as SyncJson);
}

function hex(value: string): string {
  return [...new TextEncoder().encode(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function value(row: SyncRow, field: string): string | null {
  return stringValue(row[field]);
}

function planRow(table: SyncTable, row: SyncRow): SyncRow {
  const selected = selectAllowedColumns(table, row);
  if (table !== "User") return selected;
  return Object.fromEntries(["id", "role", "regionId", "createdAt", "updatedAt"]
    .filter((field) => Object.hasOwn(selected, field)).map((field) => [field, selected[field]]));
}

function protectedSets(input: PlanDatabaseSyncInput) {
  const protectedUsers = new Set(input.protected?.userIds ?? []);
  const protectedDealers = new Set(input.protected?.dealerProfileIds ?? []);
  for (const dealerId of input.protected?.previewPackDealerProfileIds ?? []) protectedDealers.add(dealerId);
  const protectedListings = new Set(input.protected?.listingIds ?? []);
  const sampleTargets = new Set(input.protected?.sampleCheckoutTargetIds ?? []);
  for (const row of input.destination.User) {
    if (value(row, "role") === "ADMIN") protectedUsers.add(id(row) ?? "");
  }
  for (const row of input.destination.DealerProfile) {
    if (isTruthy(row, "isAdminPreview") || protectedUsers.has(value(row, "userId") ?? "")) {
      protectedDealers.add(id(row) ?? "");
    }
  }
  for (const row of input.destination.Listing) {
    if (value(row, "status") === "ADMIN_PREVIEW" || value(row, "previewPackId") !== null ||
      sampleTargets.has(id(row) ?? "") || protectedDealers.has(value(row, "dealerId") ?? "") ||
      protectedUsers.has(value(row, "userId") ?? "")) {
      protectedListings.add(id(row) ?? "");
    }
  }
  return { protectedUsers, protectedDealers, protectedListings, sampleTargets };
}

function prepareSource(input: PlanDatabaseSyncInput, blockers: Set<string>) {
  const sets = protectedSets(input);
  const source = Object.fromEntries(SYNC_TABLES.map((table) => [table, []])) as unknown as SyncDataset;
  const mappings = new Map<SyncTable, Map<string, string>>();
  for (const table of SYNC_TABLES) mappings.set(table, new Map());

  const protectedUserIds = new Set([...sets.protectedUsers]);
  const inactiveSourceOwnerIds = new Set(input.source.User
    .filter((row) => row.disabledAt !== null && row.disabledAt !== undefined || row.deletedAt !== null && row.deletedAt !== undefined)
    .map(id).filter((item): item is string => item !== null));
  for (const row of input.destination.User) {
    if (value(row, "role") === "ADMIN") protectedUserIds.add(id(row) ?? "");
  }

  const sourceDealers = input.source.DealerProfile
    .map((row) => selectAllowedColumns("DealerProfile", row))
    .filter((row) => !isTruthy(row, "isAdminPreview") && !sets.protectedDealers.has(id(row) ?? "") &&
      !sets.sampleTargets.has(id(row) ?? "") && !protectedUserIds.has(value(row, "userId") ?? "") &&
      !inactiveSourceOwnerIds.has(value(row, "userId") ?? ""));
  const retainedDealerIds = new Set(sourceDealers.map(id));
  const excludedDealerIds = new Set(input.source.DealerProfile
    .filter((row) => !retainedDealerIds.has(id(row)))
    .map(id).filter((item): item is string => item !== null));
  const sourceListings = input.source.Listing.map((row) => selectAllowedColumns("Listing", row))
    .filter((row) => value(row, "status") !== "ADMIN_PREVIEW" &&
      !sets.protectedListings.has(id(row) ?? "") && !sets.sampleTargets.has(id(row) ?? "") &&
      !excludedDealerIds.has(value(row, "dealerId") ?? "") && !protectedUserIds.has(value(row, "userId") ?? "") &&
      !inactiveSourceOwnerIds.has(value(row, "userId") ?? ""));
  const ownerIds = new Set<string>();
  for (const row of sourceDealers) {
    const ownerId = value(row, "userId");
    if (ownerId) ownerIds.add(ownerId);
  }
  for (const row of sourceListings) {
    const ownerId = value(row, "userId");
    if (ownerId) ownerIds.add(ownerId);
  }

  source.DealerProfile = sourceDealers;
  source.Listing = sourceListings;
  const retainedListingIds = new Set(sourceListings.map(id).filter((item): item is string => item !== null));
  source.ListingImage = input.source.ListingImage
    .map((row) => selectAllowedColumns("ListingImage", row))
    .filter((row) => retainedListingIds.has(value(row, "listingId") ?? ""));
  source.ListingAttributeValue = input.source.ListingAttributeValue
    .map((row) => selectAllowedColumns("ListingAttributeValue", row))
    .filter((row) => retainedListingIds.has(value(row, "listingId") ?? ""));
  source.User = input.source.User.map((row) => planRow("User", row))
    .filter((row) => ownerIds.has(id(row) ?? ""));
  for (const table of SYNC_TABLES) {
    if (table === "DealerProfile" || table === "Listing" || table === "ListingImage" || table === "ListingAttributeValue" || table === "User") continue;
    source[table] = input.source[table].map((row) => selectAllowedColumns(table, row));
  }

  // Duplicate primary keys or business identities within the source make the plan ambiguous.
  for (const table of SYNC_TABLES) {
    const keys = new Set<string>();
    const natural = tableIdentity.get(table)!;
    const naturalKeys = new Set<string>();
    for (const row of source[table]) {
      const primary = PRIMARY_KEYS[table](row);
      const identity = natural(row);
      if (!primary || !identity || keys.has(primary) || naturalKeys.has(identity)) {
        blockers.add(`Source ${table} contains a missing or duplicate primary/natural identity.`);
        continue;
      }
      keys.add(primary);
      naturalKeys.add(identity);
    }
  }

  return { source, mappings, sets };
}

function mapRef(mappings: Map<SyncTable, Map<string, string>>, table: SyncTable, raw: string | null, context: string, blockers: Set<string>): string | null {
  if (raw === null) return null;
  const mapped = mappings.get(table)!.get(raw);
  if (!mapped) blockers.add(`${context} references a production ${table} row absent from the importable source or destination.`);
  return mapped ?? null;
}

function orderCategories(rows: SyncRow[], blockers: Set<string>): SyncRow[] {
  const byId = new Map(rows.map((row) => [id(row), row]));
  const ordered: SyncRow[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (row: SyncRow) => {
    const rowId = id(row);
    if (!rowId || visited.has(rowId)) return;
    if (visiting.has(rowId)) {
      blockers.add("Source Category parent hierarchy contains a cycle.");
      return;
    }
    visiting.add(rowId);
    const parent = value(row, "parentId");
    if (parent) {
      const parentRow = byId.get(parent);
      if (!parentRow) blockers.add(`Category ${rowId} references missing parent ${parent}.`);
      else visit(parentRow);
    }
    visiting.delete(rowId);
    visited.add(rowId);
    ordered.push(row);
  };
  for (const row of rows) visit(row);
  return ordered;
}

function remapRow(
  table: SyncTable,
  raw: SyncRow,
  mappings: Map<SyncTable, Map<string, string>>,
  dealerOwnerIds: Set<string>,
  blockers: Set<string>,
): SyncRow | null {
  const row = { ...raw };
  const context = `${table} ${id(row) ?? "row"}`;
  if (table === "Category" || table === "AttributeDefinition" || table === "VehicleModel" || table === "VehicleModelAlias" || table === "User" || table === "DealerProfile" || table === "Listing") {
    const ref = table === "User" ? "regionId" : table === "DealerProfile" ? "userId" : table === "Listing" ? null :
      table === "Category" ? "parentId" : table === "AttributeDefinition" ? "categoryId" :
        table === "VehicleModel" || table === "VehicleModelAlias" ? "makeId" : null;
    const refTable: SyncTable | null = table === "User" ? "Region" : table === "DealerProfile" ? "User" :
      table === "Category" ? "Category" : table === "AttributeDefinition" ? "Category" :
        table === "VehicleModel" || table === "VehicleModelAlias" ? "VehicleMake" : null;
    if (ref && refTable) {
      const mapped = mapRef(mappings, refTable, value(row, ref), context, blockers);
      if (value(row, ref) !== null && mapped === null) return null;
      row[ref] = mapped;
    }
  }
  if (table === "VehicleModelAlias") {
    const mappedModel = mapRef(mappings, "VehicleModel", value(row, "modelId"), context, blockers);
    if (!mappedModel) return null;
    row.modelId = mappedModel;
  }
  if (table === "User") {
    const sourceId = id(row)!;
    const existing = mappings.get("User")!.has(sourceId);
    if (!existing) {
      row.authUserId = `database-sync:${sourceId}`;
      row.email = `sync-${hex(sourceId)}@example.invalid`;
      row.name = null;
      row.phone = null;
      row.bio = null;
      row.avatarUrl = null;
      row.role = dealerOwnerIds.has(sourceId) ? "DEALER" : "USER";
      row.disabledAt = null;
      row.disabledReason = null;
      row.disabledReasonCode = null;
      row.deletedAt = null;
      row.deletionReason = null;
      row.deletionRequestedAt = null;
    }
  }
  if (table === "DealerProfile") {
    row.userId = mapRef(mappings, "User", value(row, "userId"), context, blockers);
    if (!row.userId) return null;
  }
  if (table === "Listing") {
    const userId = mapRef(mappings, "User", value(row, "userId"), context, blockers);
    const categoryId = mapRef(mappings, "Category", value(row, "categoryId"), context, blockers);
    const regionId = mapRef(mappings, "Region", value(row, "regionId"), context, blockers);
    const dealerId = mapRef(mappings, "DealerProfile", value(row, "dealerId"), context, blockers);
    if (!userId || !categoryId || !regionId || (value(row, "dealerId") !== null && !dealerId)) return null;
    row.userId = userId;
    row.dealerId = dealerId;
    row.categoryId = categoryId;
    row.regionId = regionId;
  }
  if (table === "ListingImage") {
    const listingId = mapRef(mappings, "Listing", value(row, "listingId"), context, blockers);
    if (!listingId) return null;
    row.listingId = listingId;
    row.uploadIntentId = null;
  }
  if (table === "ListingAttributeValue") {
    const listingId = mapRef(mappings, "Listing", value(row, "listingId"), context, blockers);
    const attributeId = mapRef(mappings, "AttributeDefinition", value(row, "attributeDefinitionId"), context, blockers);
    if (!listingId || !attributeId) return null;
    row.listingId = listingId;
    row.attributeDefinitionId = attributeId;
  }
  return row;
}

function planTable(
  table: SyncTable,
  incoming: SyncRow[],
  destination: SyncRow[],
  mode: "merge" | "replace",
  mappings: Map<SyncTable, Map<string, string>>,
  dealerOwnerIds: Set<string>,
  operations: SyncOperation[],
  blockers: Set<string>,
  sets: ReturnType<typeof protectedSets>,
  blockedDeletes: Map<string, string[]>,
  sourceImageOrigins: PlanDatabaseSyncInput["sourceImageOrigins"],
  archiveBlockedDeletes: boolean,
  archivedListingIds: Set<string>,
  archivedDealerProfileIds: Set<string>,
) {
  const identity = tableIdentity.get(table)!;
  const byId = new Map(destination.map((row) => [PRIMARY_KEYS[table](row), selectAllowedColumns(table, row)]));
  const byNatural = new Map(destination.map((row) => [identity(selectAllowedColumns(table, row)), selectAllowedColumns(table, row)]));
  const seenDestIds = new Set<string>();
  for (const raw of incoming) {
    const sourceId = PRIMARY_KEYS[table](raw);
    const transformed = remapRow(table, raw, mappings, dealerOwnerIds, blockers);
    if (!transformed) {
      operations.push({ action: "skip", table, key: sourceId ?? "unknown", before: planRow(table, raw), reason: "A required foreign key could not be mapped." });
      continue;
    }
    const sourceNatural = identity(transformed);
    const matchingNatural = sourceNatural ? byNatural.get(sourceNatural) : undefined;
    const matchingId = byId.get(PRIMARY_KEYS[table](transformed));
    const verifiedMediaTransition = table === "ListingImage" && matchingId &&
      canTransitionLegacyImage(transformed, matchingId, sourceImageOrigins);
    const secondaryCollision = destination.find((candidate) => {
      if (table === "DealerProfile") return value(candidate, "slug") === value(transformed, "slug");
      if (table === "ListingImage") return value(candidate, "listingId") === value(transformed, "listingId") &&
        candidate.order === transformed.order;
      return false;
    });
    const secondaryId = secondaryCollision ? PRIMARY_KEYS[table](secondaryCollision) : null;
    const isKnownCollision = Boolean(secondaryId && [matchingId, matchingNatural]
      .some((candidate) => candidate && PRIMARY_KEYS[table](candidate) === secondaryId));
    if (secondaryCollision && !isKnownCollision) {
      const reason = `${table} conflicts with a different development row on a secondary unique key.`;
      blockers.add(reason);
      operations.push({ action: "skip", table, key: sourceId ?? "unknown", before: planRow(table, secondaryCollision), after: planRow(table, transformed), reason });
      continue;
    }
    if (matchingId && sourceNatural && identity(matchingId) !== sourceNatural && !matchingNatural && !verifiedMediaTransition) {
      const reason = `${table} primary key conflicts with a different natural identity.`;
      blockers.add(reason);
      operations.push({ action: "skip", table, key: sourceId ?? "unknown", before: planRow(table, matchingId), after: planRow(table, transformed), reason });
      continue;
    }
    if (matchingNatural && matchingId && PRIMARY_KEYS[table](matchingNatural) !== PRIMARY_KEYS[table](matchingId)) {
      const reason = `${table} source ID and natural identity resolve to different development rows.`;
      blockers.add(reason);
      operations.push({ action: "skip", table, key: sourceId ?? "unknown", before: planRow(table, transformed), reason });
      continue;
    }
    const existing = matchingNatural ?? matchingId;
    if (existing && isProtected(table, existing, sets)) {
      mappings.get(table)!.set(sourceId ?? "", PRIMARY_KEYS[table](existing) ?? "");
      operations.push({ action: "preserve", table, key: PRIMARY_KEYS[table](existing) ?? "unknown", before: planRow(table, existing), reason: "Development-only row is protected." });
      seenDestIds.add(PRIMARY_KEYS[table](existing) ?? "");
      continue;
    }
    if (existing) {
      const targetId = PRIMARY_KEYS[table](existing)!;
      mappings.get(table)!.set(sourceId ?? "", targetId);
      transformed.id = targetId;
      if (table === "User") {
        operations.push({ action: "preserve", table, key: targetId, before: planRow(table, existing), reason: "Existing development identity and access settings are retained." });
        seenDestIds.add(targetId);
        continue;
      }
      const normalized = selectAllowedColumns(table, transformed);
      if (!same(existing, normalized)) operations.push({ action: "update", table, key: targetId, before: planRow(table, existing), after: planRow(table, normalized) });
      seenDestIds.add(targetId);
      continue;
    }
    const newId = PRIMARY_KEYS[table](transformed);
    if (!newId) {
      blockers.add(`${table} transformed row has no primary key.`);
      continue;
    }
    const idCollision = byId.get(newId);
    if (idCollision) {
      const reason = `${table} primary key conflicts with a different natural identity.`;
      blockers.add(reason);
      operations.push({ action: "skip", table, key: newId, before: planRow(table, idCollision), after: planRow(table, transformed), reason });
      continue;
    }
    mappings.get(table)!.set(sourceId ?? "", newId);
    const normalized = selectAllowedColumns(table, transformed);
    operations.push({ action: "insert", table, key: newId, after: normalized });
    seenDestIds.add(newId);
  }

  for (const [destId, row] of byId) {
    if (!destId || seenDestIds.has(destId)) continue;
    const protectedRow = isProtected(table, row, sets);
    if (mode !== "replace" || NEVER_DELETE.has(table) || protectedRow) {
      operations.push({
        action: "preserve", table, key: destId, before: planRow(table, row),
        reason: protectedRow ? "Development-only row is protected." : mode === "merge"
          ? "Merge preserves destination-only development data."
          : "Replace retains this identity or reference row by policy.",
      });
      continue;
    }
    const blockRefs = blockedDeletes.get(`${table}:${destId}`) ?? [];
    if (blockRefs.length) {
      if (archiveBlockedDeletes && table === "Listing") {
        archivedListingIds.add(destId);
        sets.protectedListings.add(destId);
        const archived = { ...row, status: "TAKEN_DOWN" };
        if (!same(row, archived)) {
          operations.push({ action: "update", table, key: destId, before: planRow(table, row),
            after: planRow(table, archived), archive: true,
            reason: "Archived development marketplace history; status changed to TAKEN_DOWN without altering the record." });
        } else {
          operations.push({ action: "preserve", table, key: destId, before: planRow(table, row), archive: true,
            reason: "Archived development marketplace history; already TAKEN_DOWN." });
        }
        continue;
      }
      if (archiveBlockedDeletes && table === "DealerProfile") {
        archivedDealerProfileIds.add(destId);
        operations.push({ action: "preserve", table, key: destId, before: planRow(table, row), archive: true,
          reason: "Archived development dealer history; the profile is preserved unchanged." });
        continue;
      }
      const reason = `Cannot replace ${table} ${destId}; referenced by excluded data: ${blockRefs.join(", ")}.`;
      blockers.add(reason);
      operations.push({ action: "skip", table, key: destId, before: planRow(table, row), reason });
    } else {
      operations.push({ action: "delete", table, key: destId, before: planRow(table, row) });
    }
  }
}

function isProtected(table: SyncTable, row: SyncRow, sets: ReturnType<typeof protectedSets>): boolean {
  const rowId = id(row) ?? "";
  if (table === "User") return value(row, "role") === "ADMIN" || sets.protectedUsers.has(rowId);
  if (table === "DealerProfile") return isTruthy(row, "isAdminPreview") || sets.protectedDealers.has(rowId) || sets.sampleTargets.has(rowId);
  if (table === "Listing") return value(row, "status") === "ADMIN_PREVIEW" || value(row, "previewPackId") !== null ||
    sets.protectedListings.has(rowId) || sets.sampleTargets.has(rowId);
  if (table === "ListingImage" || table === "ListingAttributeValue") {
    return sets.protectedListings.has(value(row, "listingId") ?? "");
  }
  return false;
}

function canTransitionLegacyImage(source: SyncRow, target: SyncRow, sourceOrigins: PlanDatabaseSyncInput["sourceImageOrigins"]): boolean {
  const sourceId = id(source);
  const origin = sourceId ? sourceOrigins?.[sourceId] : undefined;
  if (!sourceId || sourceId !== id(target) || !origin || value(source, "provider") !== "EXTERNAL" ||
    value(source, "uploadIntentId") !== null || value(source, "assetId") !== null ||
    value(target, "provider") !== origin.provider || value(target, "publicId") !== origin.publicId ||
    value(target, "listingId") !== value(source, "listingId")) return false;
  const expected = `database-sync/${createHash("sha256").update(`${origin.provider}\u0000${origin.publicId}`).digest("hex")}`;
  return value(source, "publicId") === expected;
}

export function planDatabaseSync(input: PlanDatabaseSyncInput): DatabaseSyncPlan {
  const blockers = new Set<string>();
  const operations: SyncOperation[] = [];
  const prepared = prepareSource(input, blockers);
  const { source, mappings, sets } = prepared;
  const dealerOwnerIds = new Set(source.DealerProfile.map((row) => value(row, "userId")).filter((item): item is string => item !== null));
  const destination = Object.fromEntries(SYNC_TABLES.map((table) => [
    table, input.destination[table].map((row) => planRow(table, row)),
  ])) as unknown as SyncDataset;
  const blockedDeletes = new Map<string, string[]>();
  const archivedListingIds = new Set<string>();
  const archivedDealerProfileIds = new Set<string>();
  for (const item of input.blockedDeletes ?? []) blockedDeletes.set(`${item.table}:${item.id}`, item.references);

  const order = [...WRITE_ORDER];
  for (const table of order) {
    let rows = source[table];
    if (table === "Category") rows = orderCategories(rows, blockers);
    if (table === "User") {
      // Existing source IDs map to the corresponding development identity only.
      for (const row of rows) {
        const sourceId = id(row);
        const target = destination.User.find((candidate) => id(candidate) === sourceId);
        if (target && sourceId) mappings.get("User")!.set(sourceId, sourceId);
      }
    }
    if (table === "DealerProfile") {
      for (const row of rows) {
        const naturalOwner = value(row, "userId");
        const mappedOwner = mapRef(mappings, "User", naturalOwner, `DealerProfile ${id(row)}`, blockers);
        if (mappedOwner) row.userId = mappedOwner;
      }
    }
    const tableDest = destination[table];
    planTable(table, rows, tableDest, input.mode, mappings, dealerOwnerIds, operations, blockers, sets,
      blockedDeletes, input.sourceImageOrigins, input.archiveBlockedDeletes === true && input.mode === "replace",
      archivedListingIds, archivedDealerProfileIds);
  }

  // Deletions are emitted after inserts/updates in dependency-safe child-to-parent order.
  const plannedOrder = new Map(operations.map((operation, index) => [operation, index]));
  operations.sort((a, b) => {
    const ai = a.action === "delete" ? DELETE_ORDER.indexOf(a.table) : WRITE_ORDER.indexOf(a.table);
    const bi = b.action === "delete" ? DELETE_ORDER.indexOf(b.table) : WRITE_ORDER.indexOf(b.table);
    if (a.action === "delete" && b.action !== "delete") return 1;
    if (a.action !== "delete" && b.action === "delete") return -1;
    if (a.action === "delete" && b.action === "delete") {
      return ai - bi || (plannedOrder.get(a) ?? 0) - (plannedOrder.get(b) ?? 0);
    }
    return (plannedOrder.get(a) ?? 0) - (plannedOrder.get(b) ?? 0);
  });

  const counts = Object.fromEntries(SYNC_TABLES.map((table) => [table, { ...EMPTY_COUNTS }])) as DatabaseSyncPlan["counts"];
  for (const operation of operations) counts[operation.table][operation.action] += 1;
  return {
    mode: input.mode,
    operations,
    counts,
    blockers: [...blockers].sort(),
    sourceHash: snapshotHash(input.source),
    destinationHash: snapshotHash(input.destination),
    archivedListingIds: [...archivedListingIds].sort(),
    archivedDealerProfileIds: [...archivedDealerProfileIds].sort(),
    mappedDealerIds: Object.fromEntries([...mappings.get("DealerProfile")!.entries()].sort(([a], [b]) => a.localeCompare(b))),
    mappedListingIds: Object.fromEntries([...mappings.get("Listing")!.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}
