import type { PoolClient } from "pg";
import type { CatalogTable } from "./catalog";
import type { IdentitySnapshot } from "./identity-reconcile";
import { quoteIdent } from "./codec";
import { sourceAuthTable } from "./auth-source";
import { DatabaseSyncError } from "./snapshot";
import { EXCLUDED_SYNC_USER_IDS, excludedSyncTable, expandScopeExclusions, type ScopeExclusions, type ScopeForeignKey, type ScopeRow } from "./scope-policy";

type ScopeUser = { id: string; email: string; authUserId: string; role: string };
type ScopeDealer = { id: string; userId: string; slug: string; preview: boolean };
export type DatabaseScope = {
  rows: Record<string, ScopeRow[]>;
  keys: ScopeForeignKey[];
  excluded: ScopeExclusions;
  users: ScopeUser[];
  dealers: ScopeDealer[];
  identities: Array<{ id: string; user_id: string }>;
};
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Metadata/identity reads only. Never changes records or reconciles excluded identities. */
export async function readDatabaseScope(client: PoolClient, catalog: CatalogTable[], env: NodeJS.ProcessEnv, source = false): Promise<DatabaseScope> {
  const keys = (await client.query<ScopeForeignKey>(`SELECT child.relname::text AS child, parent.relname::text AS parent,
    ARRAY(SELECT a.attname::text FROM unnest(f.conkey) WITH ORDINALITY k(attnum,ord)
      JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=k.attnum ORDER BY ord) AS "childColumns",
    ARRAY(SELECT a.attname::text FROM unnest(f.confkey) WITH ORDINALITY k(attnum,ord)
      JOIN pg_attribute a ON a.attrelid=f.confrelid AND a.attnum=k.attnum ORDER BY ord) AS "parentColumns"
    FROM pg_constraint f JOIN pg_class child ON child.oid=f.conrelid
    JOIN pg_namespace cn ON cn.oid=child.relnamespace JOIN pg_class parent ON parent.oid=f.confrelid
    JOIN pg_namespace pn ON pn.oid=parent.relnamespace
    WHERE f.contype='f' AND cn.nspname='public' AND pn.nspname='public'`)).rows;
  const rows: Record<string, ScopeRow[]> = {};
  for (const table of catalog) {
    const fields = new Set([table.primaryKey]);
    for (const key of keys) {
      if (key.child === table.name) key.childColumns.forEach((column) => fields.add(column));
      if (key.parent === table.name) key.parentColumns.forEach((column) => fields.add(column));
    }
    const pairs = [...fields].flatMap((column) => [literal(column), `${quoteIdent(column)}::text`]);
    rows[table.name] = (await client.query<ScopeRow>(`SELECT ${quoteIdent(table.primaryKey)}::text AS id,
      jsonb_build_object(${pairs.join(",")}) AS "values" FROM public.${quoteIdent(table.name)}`)).rows;
  }
  const users = (await client.query<ScopeUser>(`SELECT id,email,"authUserId",role::text AS role FROM public."User"`)).rows;
  const dealers = (await client.query<ScopeDealer>(`SELECT d.id,d."userId",d.slug,
    (d."isAdminPreview" OR EXISTS(SELECT 1 FROM public."DealerPreviewPack" p WHERE p."dealerProfileId"=d.id)) AS preview
    FROM public."DealerProfile" d`)).rows;
  const roots: ScopeExclusions = { User: [...EXCLUDED_SYNC_USER_IDS], DealerProfile: [] };
  for (const user of users) {
    if (user.role === "ADMIN" || user.authUserId.startsWith("preview-system:") || user.email.trim().toLowerCase().endsWith("@preview.internal")) roots.User.push(user.id);
  }
  for (const dealer of dealers) if (dealer.preview) {
    roots.DealerProfile.push(dealer.id);
    roots.User.push(dealer.userId);
  }
  const previewListings = (await client.query<{ id: string }>(`SELECT id FROM public."Listing" WHERE status='ADMIN_PREVIEW' OR "previewPackId" IS NOT NULL`)).rows;
  roots.Listing = previewListings.map((row) => row.id);
  const authRelation = source ? sourceAuthTable("identities", env) : "auth.identities";
  const identities = (await client.query<{ id: string; user_id: string }>(`SELECT id::text AS id,user_id::text AS user_id FROM ${authRelation}`)).rows;
  const scope: DatabaseScope = { rows, keys, users, dealers, identities, excluded: expandScopeExclusions(rows, keys, roots) };
  protectAuth(scope);
  return scope;
}

function protectAuth(scope: DatabaseScope) {
  const users = new Set(scope.excluded.User ?? []);
  const auth = new Set(scope.users.filter((user) => users.has(user.id)).map((user) => user.authUserId));
  scope.excluded["auth.users"] = [...auth];
  scope.excluded["auth.identities"] = scope.identities.filter((row) => auth.has(row.user_id)).map((row) => row.id);
}

/** Preserve destination exclusions even when production has a different primary key. */
export function protectDestinationScope(source: DatabaseScope, destination: DatabaseScope): DatabaseScope {
  const roots: ScopeExclusions = Object.fromEntries(Object.entries(source.excluded).map(([table, ids]) => [table, [...ids, ...(destination.excluded[table] ?? [])]]));
  const users = destination.users.filter((user) => destination.excluded.User?.includes(user.id));
  const ids = new Set(users.map((user) => user.id));
  const emails = new Set(users.map((user) => user.email.trim().toLowerCase()));
  const auth = new Set(users.map((user) => user.authUserId));
  for (const user of source.users) if (ids.has(user.id) || emails.has(user.email.trim().toLowerCase()) || auth.has(user.authUserId)) roots.User.push(user.id);
  const dealerSlugs = new Set(destination.dealers.filter((dealer) => destination.excluded.DealerProfile?.includes(dealer.id)).map((dealer) => dealer.slug));
  for (const dealer of source.dealers) if (dealerSlugs.has(dealer.slug)) roots.DealerProfile.push(dealer.id);
  const scope = { ...source, excluded: expandScopeExclusions(source.rows, source.keys, roots) };
  protectAuth(scope);
  scope.excluded["auth.users"] = [...new Set([...scope.excluded["auth.users"], ...(destination.excluded["auth.users"] ?? [])])];
  scope.excluded["auth.identities"] = [...new Set([...scope.excluded["auth.identities"], ...source.identities.filter((row) => scope.excluded["auth.users"].includes(row.user_id)).map((row) => row.id), ...(destination.excluded["auth.identities"] ?? [])])];
  return scope;
}

export function filterIdentityScope(snapshot: IdentitySnapshot, source: DatabaseScope, destination: DatabaseScope): IdentitySnapshot {
  const select = <T extends { id: string }>(rows: readonly T[], table: string, scope: DatabaseScope) => rows.filter((row) => !scope.excluded[table]?.includes(row.id));
  return {
    ...snapshot,
    users: { source: select(snapshot.users.source, "User", source), destination: select(snapshot.users.destination, "User", destination) },
    dealers: { source: select(snapshot.dealers.source, "DealerProfile", source), destination: select(snapshot.dealers.destination, "DealerProfile", destination) },
    policies: { source: select(snapshot.policies.source, "PolicyAcceptance", source), destination: select(snapshot.policies.destination, "PolicyAcceptance", destination) },
    packs: { source: [], destination: [] }, waitlist: { source: [], destination: [] }, issues: { source: [], destination: [] }, promotions: { source: [], destination: [] },
  };
}

export function filterScopeRows(table: string, primaryKey: string, columns: readonly { name: string }[], rows: readonly (readonly (string | null)[])[], excluded: ScopeExclusions): Array<Array<string | null>> {
  if (excludedSyncTable(table)) return [];
  const omitted = new Set(excluded[table] ?? []);
  const key = columns.findIndex((column) => column.name === primaryKey);
  if (key < 0 && rows.length) throw new DatabaseSyncError(`Required key is missing for scoped ${table}.`);
  return rows.filter((row) => !omitted.has(String(row[key]))).map((row) => [...row]);
}

/** Recheck the destination at apply time, before any data writes or backup pruning. */
export function assertScopedPayload(table: string, primaryKey: string, columns: readonly { name: string }[], rows: readonly (readonly (string | null)[])[], scope: DatabaseScope) {
  if (filterScopeRows(table, primaryKey, columns, rows, scope.excluded).length !== rows.length) {
    throw new DatabaseSyncError(`Excluded ${table} ownership changed after the preview. Prepare a fresh plan.`);
  }
  for (const key of scope.keys.filter((key) => key.child === table)) {
    const indexes = key.childColumns.map((column) => columns.findIndex((item) => item.name === column));
    if (indexes.some((index) => index < 0)) continue;
    const protectedIds = new Set(scope.excluded[key.parent] ?? []);
    const tuples = new Set((scope.rows[key.parent] ?? []).filter((row) => protectedIds.has(row.id)).map((row) => JSON.stringify(key.parentColumns.map((column) => row.values[column]))));
    if (rows.some((row) => {
      const values = indexes.map((index) => row[index]);
      return values.every((value) => value != null) && (excludedSyncTable(key.parent) || tuples.has(JSON.stringify(values)));
    })) throw new DatabaseSyncError(`${table} now references excluded staging data. Prepare a fresh plan.`);
  }
  if (table === "auth.identities") {
    const index = columns.findIndex((column) => column.name === "user_id");
    if (rows.some((row) => scope.excluded["auth.users"]?.includes(String(row[index])))) throw new DatabaseSyncError("An excluded authentication identity changed after the preview. Prepare a fresh plan.");
  }
}
