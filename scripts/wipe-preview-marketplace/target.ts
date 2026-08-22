export const PREVIEW_PROJECT_REF = "syneonzucehwlghqmfbg";
export const PRODUCTION_PROJECT_REF = "snlqivvogfqesxpbjiei";
export const PREVIEW_DB_HOST = `db.${PREVIEW_PROJECT_REF}.supabase.co`;
export const PREVIEW_SUPABASE_HOST = `${PREVIEW_PROJECT_REF}.supabase.co`;
export const PREVIEW_POOLER_USER = `postgres.${PREVIEW_PROJECT_REF}`;

export const KEEP_ACCOUNT_EMAILS = [
  "admin@mpdee.co.uk",
  "d.p.marshall@hotmail.co.uk",
  "davooomarsh@hotmail.com",
  "mattduff36@gmail.com",
] as const;

export const DELETE_AUTH_EMAILS = ["noreply@avsquires.co.uk"] as const;

export const EXPECTED_KEPT_DEALERS = [
  { name: "Morris motors", ownerEmail: "d.p.marshall@hotmail.co.uk" },
  { name: "Matt Duffill TEST", ownerEmail: "mattduff36@gmail.com" },
] as const;

export const EXPECTED_KEPT_DEALER_NAMES = EXPECTED_KEPT_DEALERS.map(
  (dealer) => dealer.name,
);

export const PRESERVE_COUNT_KEYS = [
  "waitlistUsers",
  "siteSettings",
  "regions",
  "categories",
  "costEntries",
] as const;

export type PreserveCounts = Record<(typeof PRESERVE_COUNT_KEYS)[number], number>;

export interface PreviewWipeTargetInput {
  databaseUrl?: string;
  postgresUrlNonPooling?: string;
  supabaseUrl?: string;
}

function parseUrl(raw: string | undefined): URL | null {
  if (!raw?.trim()) return null;
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

function containsProductionRef(value: string | null | undefined) {
  return Boolean(value && value.toLowerCase().includes(PRODUCTION_PROJECT_REF));
}

export function isAllowedPreviewDatabaseUrl(connectionString: string | undefined) {
  const parsed = parseUrl(connectionString);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  const user = decodeURIComponent(parsed.username || "").toLowerCase();
  if (containsProductionRef(host) || containsProductionRef(user)) return false;
  if (host === PREVIEW_DB_HOST) return true;
  if (host.endsWith(".pooler.supabase.com") && user === PREVIEW_POOLER_USER) {
    return true;
  }
  return false;
}

export function isAllowedPreviewSupabaseUrl(raw: string | undefined) {
  const parsed = parseUrl(raw);
  if (!parsed) return false;
  if (parsed.protocol !== "https:") return false;
  if (parsed.hostname.toLowerCase() !== PREVIEW_SUPABASE_HOST) return false;
  if (parsed.port && parsed.port !== "443") return false;
  if (parsed.username || parsed.password) return false;
  if (containsProductionRef(parsed.hostname)) return false;
  return true;
}

export function assertPreviewWipeTarget(input: PreviewWipeTargetInput) {
  if (!isAllowedPreviewSupabaseUrl(input.supabaseUrl)) {
    throw new Error(
      `Refusing wipe: NEXT_PUBLIC_SUPABASE_URL must be https://${PREVIEW_SUPABASE_HOST}`,
    );
  }

  const dbUrls = [input.databaseUrl, input.postgresUrlNonPooling].filter(
    (value): value is string => Boolean(value?.trim()),
  );
  if (dbUrls.length === 0) {
    throw new Error("Refusing wipe: missing DATABASE_URL or POSTGRES_URL_NON_POOLING.");
  }
  for (const url of dbUrls) {
    if (!isAllowedPreviewDatabaseUrl(url)) {
      throw new Error("Refusing wipe: database URL is not the new-ford-dealership preview.");
    }
  }
}

export function chooseWipeConnectionString(input: PreviewWipeTargetInput) {
  assertPreviewWipeTarget(input);
  const database = parseUrl(input.databaseUrl);
  if (database && database.hostname.toLowerCase() === PREVIEW_DB_HOST) {
    return input.databaseUrl!.trim();
  }
  if (input.postgresUrlNonPooling && isAllowedPreviewDatabaseUrl(input.postgresUrlNonPooling)) {
    return input.postgresUrlNonPooling.trim();
  }
  throw new Error("Refusing wipe: no allowed preview connection string.");
}

export function resolvePreservedUserIds(users: Array<{ id: string; email: string }>) {
  const byEmail = new Map(users.map((user) => [user.email.trim().toLowerCase(), user.id]));
  const missing = KEEP_ACCOUNT_EMAILS.filter((email) => !byEmail.has(email));
  if (missing.length > 0) {
    throw new Error(`Keep-list users missing: ${missing.join(", ")}`);
  }
  return KEEP_ACCOUNT_EMAILS.map((email) => byEmail.get(email)!);
}

export function assertKeptDealerProfiles(profiles: Array<{ name: string }>) {
  const actual = profiles.map((profile) => profile.name).sort();
  const expected = [...EXPECTED_KEPT_DEALER_NAMES].sort();
  if (
    actual.length !== expected.length ||
    actual.some((name, index) => name !== expected[index])
  ) {
    throw new Error(`Kept dealer profiles mismatch: ${actual.join(", ") || "(none)"}`);
  }
}

export function assertPreserveCountsUnchanged(before: PreserveCounts, after: PreserveCounts) {
  for (const key of PRESERVE_COUNT_KEYS) {
    if (before[key] !== after[key]) {
      throw new Error(`Preserved ${key} changed: ${before[key]} -> ${after[key]}`);
    }
  }
}

export function assertKeptEmails(
  actualEmails: string[],
  expected: readonly string[] = KEEP_ACCOUNT_EMAILS,
) {
  const actual = [...actualEmails.map((email) => email.trim().toLowerCase())].sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((email, index) => email !== wanted[index])) {
    throw new Error(`Kept emails mismatch: ${actual.join(", ") || "(none)"}`);
  }
}

export function assertPreflightAuthRoster(emails: string[]) {
  assertKeptEmails(emails, [...KEEP_ACCOUNT_EMAILS, ...DELETE_AUTH_EMAILS]);
}

export function assertPreflightKeptDealers(
  profiles: Array<{ name: string; ownerEmail: string }>,
) {
  const keep = new Set<string>(KEEP_ACCOUNT_EMAILS);
  const kept = profiles
    .filter((profile) => keep.has(profile.ownerEmail.trim().toLowerCase()))
    .map((profile) => ({
      name: profile.name.trim(),
      ownerEmail: profile.ownerEmail.trim().toLowerCase(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const expected = [...EXPECTED_KEPT_DEALERS]
    .map((dealer) => ({
      name: dealer.name,
      ownerEmail: dealer.ownerEmail,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (
    kept.length !== expected.length ||
    kept.some(
      (dealer, index) =>
        dealer.name !== expected[index].name ||
        dealer.ownerEmail !== expected[index].ownerEmail,
    )
  ) {
    throw new Error(
      `Kept dealer ownership mismatch: ${kept
        .map((dealer) => `${dealer.name}<${dealer.ownerEmail}>`)
        .join(", ") || "(none)"}`,
    );
  }
}

export function assertPreviewWipePreflight(input: {
  users: Array<{ id: string; email: string; dealerName?: string | null }>;
  authUsers: Array<{ id: string; email: string | null }>;
}) {
  const preservedUserIds = resolvePreservedUserIds(input.users);
  assertPreflightAuthRoster(
    input.authUsers.map((user) => user.email ?? `__no_email__:${user.id}`),
  );
  assertPreflightKeptDealers(
    input.users
      .filter((user) => user.dealerName)
      .map((user) => ({
        name: user.dealerName!,
        ownerEmail: user.email,
      })),
  );
  return { preservedUserIds };
}
