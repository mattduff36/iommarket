export type UserIdentity = {
  id: string;
  email: string;
  authUserId: string;
  role: string;
  disabled: boolean;
  deleted: boolean;
};

export type DealerIdentity = { id: string; userId: string; slug: string; preview: boolean };
export type PackIdentity = { id: string; dealerKey: string; dealerProfileId: string };
export type PolicyIdentity = {
  id: string;
  userId: string;
  acceptanceType: string;
  bundleVersion: string;
  payload: string;
  source: string;
};
export type NaturalIdentity = { id: string; naturalKey: string; fields: Record<string, string> };

export type IdentitySnapshot = {
  users: { source: readonly UserIdentity[]; destination: readonly UserIdentity[] };
  dealers: { source: readonly DealerIdentity[]; destination: readonly DealerIdentity[] };
  packs: { source: readonly PackIdentity[]; destination: readonly PackIdentity[] };
  policies: { source: readonly PolicyIdentity[]; destination: readonly PolicyIdentity[] };
  waitlist: { source: readonly NaturalIdentity[]; destination: readonly NaturalIdentity[] };
  issues: { source: readonly NaturalIdentity[]; destination: readonly NaturalIdentity[] };
  promotions: { source: readonly NaturalIdentity[]; destination: readonly NaturalIdentity[] };
};

export type IdentityLink = { table: string; sourceId: string; destinationId: string };

export type IdentityReconciliation = {
  links: IdentityLink[];
  blockers: string[];
  notes: string[];
};

type Queryable = { query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }> };

const WAITLIST_FIELDS: Array<[string, string]> = [
  ["status", "status"],
  ["recipientTotal", "recipient total"],
  ["sentCount", "sent count"],
  ["failedCount", "failed count"],
  ["skippedCount", "skipped count"],
  ["body", "body"],
];
const ISSUE_FIELDS: Array<[string, string]> = [
  ["status", "status"],
  ["severity", "severity"],
  ["source", "source"],
  ["occurrences", "occurrences"],
];
const PROMOTION_FIELDS: Array<[string, string]> = [
  ["timezone", "timezone"],
  ["startsAt", "starts at"],
  ["endsAt", "ends at"],
  ["tier", "tier"],
];

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function flag(value: unknown): boolean {
  return value === true;
}

function byKey<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const value = key(row);
    grouped.set(value, [...(grouped.get(value) ?? []), row]);
  }
  return grouped;
}

function humanList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function note(count: number, table: string, detail: string): string | null {
  if (!count) return null;
  const noun = count === 1 ? "row" : "rows";
  return `${count} ${table} ${noun} will update the development record ${detail}.`;
}

function reconcileUsers(source: readonly UserIdentity[], destination: readonly UserIdentity[], blockers: string[]): IdentityLink[] {
  const destinationIds = new Set(destination.map((row) => row.id));
  const sourceIds = new Set(source.map((row) => row.id));
  const byEmail = byKey(destination, (row) => row.email);
  const byAuth = byKey(destination, (row) => row.authUserId);
  const claimed = new Map<string, string>();
  const links: IdentityLink[] = [];
  for (const row of [...source].sort((left, right) => left.id.localeCompare(right.id))) {
    const emailHits = (byEmail.get(row.email) ?? []).filter((hit) => hit.id !== row.id);
    const authHits = (byAuth.get(row.authUserId) ?? []).filter((hit) => hit.id !== row.id);
    if (destinationIds.has(row.id)) {
      if (emailHits.length === 1 && authHits.length === 0) {
        blockers.push(`User ${row.id} already exists in development, but its production email belongs to development user ${emailHits[0].id} and the auth subjects differ.`);
      } else if (authHits.length === 1 && emailHits.length === 0) {
        blockers.push(`User ${row.id} already exists in development, but its production auth subject belongs to development user ${authHits[0].id} and the emails differ.`);
      } else if (emailHits.length === 1 && authHits.length === 1 && emailHits[0].id === authHits[0].id) {
        blockers.push(`User ${row.id} exists in both databases with a different email and auth subject. Those production values belong to development user ${emailHits[0].id}, so the rows were not merged.`);
      } else if (emailHits.length || authHits.length) {
        blockers.push(`User ${row.id} matches more than one development user on email or auth subject, so it was not merged.`);
      }
      continue;
    }
    if (emailHits.length === 1 && authHits.length === 1 && emailHits[0].id === authHits[0].id) {
      const matched = emailHits[0];
      if (row.role === "ADMIN" || matched.role === "ADMIN") {
        blockers.push(`User ${row.id} matches development user ${matched.id} on email and auth subject, but one side is an administrator.`);
      } else if (row.role !== matched.role) {
        blockers.push(`User ${row.id} matches development user ${matched.id} on email and auth subject, but the roles differ.`);
      } else if (row.disabled || row.deleted || matched.disabled || matched.deleted) {
        blockers.push(`User ${row.id} matches development user ${matched.id} on email and auth subject, but one side is disabled or deleted.`);
      } else if (sourceIds.has(matched.id)) {
        blockers.push(`User ${row.id} matches development user ${matched.id}, which is also a production user id, so the rows were not merged.`);
      } else if (claimed.has(matched.id)) {
        const previous = claimed.get(matched.id) ?? "";
        claimed.delete(matched.id);
        const remove = links.findIndex((link) => link.table === "User" && link.sourceId === previous);
        if (remove >= 0) links.splice(remove, 1);
        blockers.push(`Users ${previous} and ${row.id} both match development user ${matched.id}, so neither was merged.`);
      } else {
        claimed.set(matched.id, row.id);
        links.push({ table: "User", sourceId: row.id, destinationId: matched.id });
      }
      continue;
    }
    if (emailHits.length > 0 && authHits.length === 0) {
      blockers.push(`User ${row.id} matches development user ${emailHits.map((hit) => hit.id).join(", ")} by email only. Auth subjects differ, so these users were not merged.`);
    } else if (authHits.length > 0 && emailHits.length === 0) {
      blockers.push(`User ${row.id} matches development user ${authHits.map((hit) => hit.id).join(", ")} by auth subject only. Emails differ, so these users were not merged.`);
    } else if (emailHits.length || authHits.length) {
      blockers.push(`User ${row.id} email and auth subject point at different development users, so it was not merged.`);
    }
  }
  return links;
}

function reconcileDealers(
  source: readonly DealerIdentity[],
  destination: readonly DealerIdentity[],
  userLinks: ReadonlyMap<string, string>,
  blockers: string[],
): IdentityLink[] {
  const sourceIds = new Set(source.map((row) => row.id));
  const bySlug = new Map(destination.map((row) => [row.slug, row]));
  const byUser = new Map(destination.map((row) => [row.userId, row]));
  const links: IdentityLink[] = [];
  for (const row of [...source].sort((left, right) => left.id.localeCompare(right.id))) {
    if (destination.some((item) => item.id === row.id)) continue;
    const mappedUser = userLinks.get(row.userId);
    const slugHit = bySlug.get(row.slug);
    const userHit = mappedUser ? byUser.get(mappedUser) : undefined;
    if (!slugHit && !userHit) continue;
    if (slugHit && userHit && slugHit.id === userHit.id && !sourceIds.has(slugHit.id)) {
      if (row.preview !== slugHit.preview) {
        blockers.push(`DealerProfile ${row.id} matches development dealer ${slugHit.id} on slug and linked user, but the preview flags differ.`);
        continue;
      }
      links.push({ table: "DealerProfile", sourceId: row.id, destinationId: slugHit.id });
      continue;
    }
    if (slugHit && !mappedUser) {
      blockers.push(`DealerProfile ${row.id} matches development dealer ${slugHit.id} on slug, but the users are not the same email and auth identity.`);
    } else {
      blockers.push(`DealerProfile ${row.id} slug and linked user point at different development dealers, so it was not merged.`);
    }
  }
  return links;
}

function reconcilePacks(
  source: readonly PackIdentity[],
  destination: readonly PackIdentity[],
  dealerLinks: ReadonlyMap<string, string>,
  blockers: string[],
): IdentityLink[] {
  const sourceIds = new Set(source.map((row) => row.id));
  const byKey = new Map(destination.map((row) => [row.dealerKey, row]));
  const byDealer = new Map(destination.map((row) => [row.dealerProfileId, row]));
  const links: IdentityLink[] = [];
  for (const row of [...source].sort((left, right) => left.id.localeCompare(right.id))) {
    if (destination.some((item) => item.id === row.id)) continue;
    const mappedDealer = dealerLinks.get(row.dealerProfileId);
    const keyHit = byKey.get(row.dealerKey);
    const dealerHit = mappedDealer ? byDealer.get(mappedDealer) : undefined;
    if (!keyHit && !dealerHit) continue;
    if (keyHit && dealerHit && keyHit.id === dealerHit.id && !sourceIds.has(keyHit.id)) {
      links.push({ table: "DealerPreviewPack", sourceId: row.id, destinationId: keyHit.id });
      continue;
    }
    if (keyHit && !mappedDealer) {
      blockers.push(`DealerPreviewPack ${row.id} matches development pack ${keyHit.id} on dealer key, but the dealer profiles are not the same linked dealer.`);
    } else {
      blockers.push(`DealerPreviewPack ${row.id} dealer key and linked profile point at different development packs, so it was not merged.`);
    }
  }
  return links;
}

function reconcilePolicies(
  source: readonly PolicyIdentity[],
  destination: readonly PolicyIdentity[],
  userLinks: ReadonlyMap<string, string>,
  blockers: string[],
): IdentityLink[] {
  const sourceIds = new Set(source.map((row) => row.id));
  const byNatural = new Map(destination.map((row) => [`${row.userId}|${row.acceptanceType}|${row.bundleVersion}`, row]));
  const links: IdentityLink[] = [];
  for (const row of [...source].sort((left, right) => left.id.localeCompare(right.id))) {
    if (sourceIds.has(row.id) && destination.some((item) => item.id === row.id)) continue;
    const userId = userLinks.get(row.userId) ?? row.userId;
    const matched = byNatural.get(`${userId}|${row.acceptanceType}|${row.bundleVersion}`);
    if (!matched || matched.id === row.id || sourceIds.has(matched.id)) continue;
    if (matched.payload === row.payload && matched.source === row.source) {
      links.push({ table: "PolicyAcceptance", sourceId: row.id, destinationId: matched.id });
    } else {
      blockers.push(`PolicyAcceptance ${row.id} matches development ${matched.id} for the same user, acceptance type, and bundle version, but the recorded consent differs.`);
    }
  }
  return links;
}

function reconcileNatural(
  table: string,
  source: readonly NaturalIdentity[],
  destination: readonly NaturalIdentity[],
  fields: ReadonlyArray<readonly [string, string]>,
  blockers: string[],
): IdentityLink[] {
  const sourceIds = new Set(source.map((row) => row.id));
  const grouped = byKey(destination, (row) => row.naturalKey);
  const links: IdentityLink[] = [];
  for (const row of [...source].sort((left, right) => left.id.localeCompare(right.id))) {
    const hits = (grouped.get(row.naturalKey) ?? []).filter((hit) => hit.id !== row.id);
    if (!hits.length) continue;
    if (hits.length !== 1 || sourceIds.has(hits[0].id)) {
      blockers.push(`${table} ${row.id} matches more than one development row on its natural key, so it was not merged.`);
      continue;
    }
    const matched = hits[0];
    const diffs = fields.filter(([name]) => row.fields[name] !== matched.fields[name]).map(([, label]) => label);
    if (!diffs.length) links.push({ table, sourceId: row.id, destinationId: matched.id });
    else blockers.push(`${table} ${row.id} matches development ${matched.id} on its natural key, but ${humanList(diffs)} differ.`);
  }
  return links;
}

export function reconcileIdentities(snapshot: IdentitySnapshot): IdentityReconciliation {
  const blockers: string[] = [];
  const userLinks = reconcileUsers(snapshot.users.source, snapshot.users.destination, blockers);
  const users = new Map(userLinks.map((link) => [link.sourceId, link.destinationId]));
  const dealerLinks = reconcileDealers(snapshot.dealers.source, snapshot.dealers.destination, users, blockers);
  const dealers = new Map(dealerLinks.map((link) => [link.sourceId, link.destinationId]));
  const packLinks = reconcilePacks(snapshot.packs.source, snapshot.packs.destination, dealers, blockers);
  const policyLinks = reconcilePolicies(snapshot.policies.source, snapshot.policies.destination, users, blockers);
  const waitlistLinks = reconcileNatural("WaitlistEarlyAccessCampaign", snapshot.waitlist.source, snapshot.waitlist.destination, WAITLIST_FIELDS, blockers);
  const issueLinks = reconcileNatural("MonitoringIssue", snapshot.issues.source, snapshot.issues.destination, ISSUE_FIELDS, blockers);
  const promotionLinks = reconcileNatural("DealerPromotionCampaign", snapshot.promotions.source, snapshot.promotions.destination, PROMOTION_FIELDS, blockers);
  const links = [...userLinks, ...dealerLinks, ...packLinks, ...policyLinks, ...waitlistLinks, ...issueLinks, ...promotionLinks];
  const notes = [
    note(userLinks.length, "User", "with the same email and auth subject"),
    note(dealerLinks.length, "DealerProfile", "with the same slug and linked user"),
    note(packLinks.length, "DealerPreviewPack", "with the same dealer key and linked profile"),
    note(policyLinks.length, "PolicyAcceptance", "with the same user, acceptance type, bundle version, and recorded consent"),
    note(waitlistLinks.length, "WaitlistEarlyAccessCampaign", "with the same natural key and campaign state"),
    note(issueLinks.length, "MonitoringIssue", "with the same fingerprint and issue state"),
    note(promotionLinks.length, "DealerPromotionCampaign", "with the same natural key and schedule"),
  ].filter((item): item is string => item != null);
  return { links, blockers: blockers.sort(), notes };
}

export function indexIdentityLinks(links: readonly IdentityLink[]): Map<string, Map<string, string>> {
  const index = new Map<string, Map<string, string>>();
  for (const link of links) {
    const table = index.get(link.table) ?? new Map<string, string>();
    table.set(link.sourceId, link.destinationId);
    index.set(link.table, table);
  }
  return index;
}

export function foreignKeyParents(keys: readonly { child: string; parent: string; childColumns: readonly string[] }[]): Map<string, string> {
  const parents = new Map<string, string>();
  for (const key of keys) {
    for (const column of key.childColumns) {
      const name = `${key.child}.${column}`;
      const existing = parents.get(name);
      if (existing && existing !== key.parent) parents.set(name, "");
      else parents.set(name, key.parent);
    }
  }
  return parents;
}

export function remapRows(
  table: string,
  primaryKey: string,
  columns: readonly { name: string }[],
  rows: readonly (readonly (string | null)[])[],
  links: ReadonlyMap<string, ReadonlyMap<string, string>>,
  parents: ReadonlyMap<string, string>,
): Array<Array<string | null>> {
  return rows.map((row) => row.map((value, index) => {
    if (value == null) return null;
    const column = columns[index]?.name ?? "";
    if (column === primaryKey) return links.get(table)?.get(value) ?? value;
    const parent = parents.get(`${table}.${column}`);
    if (!parent) return value;
    return links.get(parent)?.get(value) ?? value;
  }));
}

async function rowsOf(client: Queryable, sql: string): Promise<Array<Record<string, unknown>>> {
  return (await client.query(sql)).rows;
}

function userRow(row: Record<string, unknown>): UserIdentity {
  return {
    id: text(row.id),
    email: text(row.email),
    authUserId: text(row.authUserId),
    role: text(row.role),
    disabled: flag(row.disabled),
    deleted: flag(row.deleted),
  };
}

function naturalRows(rows: Array<Record<string, unknown>>, key: string, fields: readonly string[]): NaturalIdentity[] {
  return rows.map((row) => ({
    id: text(row.id),
    naturalKey: text(row[key]),
    fields: Object.fromEntries(fields.map((field) => [field, text(row[field])])),
  }));
}

async function loadSide(client: Queryable) {
  const users = await rowsOf(client, `SELECT id, email, "authUserId", role::text AS role, "disabledAt" IS NOT NULL AS disabled, "deletedAt" IS NOT NULL AS deleted FROM public."User"`);
  const dealers = await rowsOf(client, `SELECT id, "userId", slug, "isAdminPreview" AS preview FROM public."DealerProfile"`);
  const packs = await rowsOf(client, `SELECT id, "dealerKey", "dealerProfileId" FROM public."DealerPreviewPack"`);
  const policies = await rowsOf(client, `SELECT id, "userId", "acceptanceType"::text AS "acceptanceType", "bundleVersion", md5("policyVersions"::text) AS payload, source::text AS source FROM public."PolicyAcceptance"`);
  const waitlist = await rowsOf(client, `SELECT id, key, status::text AS status, "recipientTotal"::text AS "recipientTotal", "sentCount"::text AS "sentCount", "failedCount"::text AS "failedCount", "skippedCount"::text AS "skippedCount", md5("bodyText") AS body FROM public."WaitlistEarlyAccessCampaign"`);
  const issues = await rowsOf(client, `SELECT id, fingerprint, status::text AS status, severity::text AS severity, source::text AS source, occurrences::text AS occurrences FROM public."MonitoringIssue"`);
  const promotions = await rowsOf(client, `SELECT id, key, timezone, "startsAt"::text AS "startsAt", "endsAt"::text AS "endsAt", tier::text AS tier FROM public."DealerPromotionCampaign"`);
  return { users, dealers, packs, policies, waitlist, issues, promotions };
}

export async function readIdentitySnapshot(source: Queryable, destination: Queryable): Promise<IdentitySnapshot> {
  const [sourceSide, destinationSide] = await Promise.all([loadSide(source), loadSide(destination)]);
  const sourceUsers = sourceSide.users;
  const destinationUsers = destinationSide.users;
  const sourceDealers = sourceSide.dealers;
  const destinationDealers = destinationSide.dealers;
  const sourcePacks = sourceSide.packs;
  const destinationPacks = destinationSide.packs;
  const sourcePolicies = sourceSide.policies;
  const destinationPolicies = destinationSide.policies;
  const sourceWaitlist = sourceSide.waitlist;
  const destinationWaitlist = destinationSide.waitlist;
  const sourceIssues = sourceSide.issues;
  const destinationIssues = destinationSide.issues;
  const sourcePromotions = sourceSide.promotions;
  const destinationPromotions = destinationSide.promotions;
  const dealer = (row: Record<string, unknown>): DealerIdentity => ({
    id: text(row.id), userId: text(row.userId), slug: text(row.slug), preview: flag(row.preview),
  });
  const pack = (row: Record<string, unknown>): PackIdentity => ({
    id: text(row.id), dealerKey: text(row.dealerKey), dealerProfileId: text(row.dealerProfileId),
  });
  const policy = (row: Record<string, unknown>): PolicyIdentity => ({
    id: text(row.id), userId: text(row.userId), acceptanceType: text(row.acceptanceType),
    bundleVersion: text(row.bundleVersion), payload: text(row.payload), source: text(row.source),
  });
  return {
    users: { source: sourceUsers.map(userRow), destination: destinationUsers.map(userRow) },
    dealers: { source: sourceDealers.map(dealer), destination: destinationDealers.map(dealer) },
    packs: { source: sourcePacks.map(pack), destination: destinationPacks.map(pack) },
    policies: { source: sourcePolicies.map(policy), destination: destinationPolicies.map(policy) },
    waitlist: { source: naturalRows(sourceWaitlist, "key", WAITLIST_FIELDS.map(([field]) => field)), destination: naturalRows(destinationWaitlist, "key", WAITLIST_FIELDS.map(([field]) => field)) },
    issues: { source: naturalRows(sourceIssues, "fingerprint", ISSUE_FIELDS.map(([field]) => field)), destination: naturalRows(destinationIssues, "fingerprint", ISSUE_FIELDS.map(([field]) => field)) },
    promotions: { source: naturalRows(sourcePromotions, "key", PROMOTION_FIELDS.map(([field]) => field)), destination: naturalRows(destinationPromotions, "key", PROMOTION_FIELDS.map(([field]) => field)) },
  };
}
