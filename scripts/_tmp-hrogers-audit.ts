import { readFileSync } from "node:fs";
import pg from "pg";
import { buildDatabasePoolOptions } from "d:/Websites/iommarket/lib/db/pool-options.ts";

const EMAIL = "hrogers095@gmail.com";
const MASK = "hr***@gmail.com";
const REF = "snlqivvogfqesxpbjiei";

function parseDotenv(contents: string) {
  const values: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value.replace(/\\n/g, "\n");
  }
  return values;
}

const env = parseDotenv(readFileSync("d:/Websites/iommarket/.env.production", "utf8"));
const raw = env.POSTGRES_URL_NON_POOLING || env.DATABASE_URL || env.POSTGRES_URL;
if (!raw) throw new Error("missing database url");
const parsed = new URL(raw);
const host = parsed.hostname.toLowerCase();
const user = decodeURIComponent(parsed.username).toLowerCase();
const direct = host === `db.${REF}.supabase.co` && user === "postgres";
const pooler =
  host.endsWith(".pooler.supabase.com") && user === `postgres.${REF}`;
if (!direct && !pooler) {
  throw new Error("refusing non-production database target");
}

process.env.SUPABASE_DB_CA_CERT = env.SUPABASE_DB_CA_CERT;
process.env.NODE_ENV = "production";
const pool = new pg.Pool(buildDatabasePoolOptions(raw, process.env));

async function main() {

async function q(sql: string, params: unknown[] = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function section(name: string, fn: () => Promise<unknown>) {
  try {
    return await fn();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "query failed" };
  }
}

try {
  const report = {
    target: {
      host,
      mode: direct ? "direct" : "pooler",
      database: (await q(`SELECT current_database() AS db`))[0]?.db,
    },
    appUser: await section("appUser", () =>
      q(
        `SELECT id, "authUserId", email, name, phone IS NOT NULL AS has_phone,
                role::text, "regionId", "disabledAt", "disabledReason", "disabledReasonCode"::text,
                "deletedAt", "deletionReason", "deletionRequestedAt", "createdAt", "updatedAt"
         FROM "User" WHERE lower(email) = lower($1)`,
        [EMAIL],
      ),
    ),
    waitlist: await section("waitlist", () =>
      q(
        `SELECT id, email, interests, source, "deletedAt", "deletionReason",
                "marketingConsentAt", "marketingPolicyVersion", "marketingWithdrawnAt",
                "createdAt", "updatedAt"
         FROM "WaitlistUser" WHERE lower(email) = lower($1)`,
        [EMAIL],
      ),
    ),
    authUsers: await section("authUsers", () =>
      q(
        `SELECT id::text, email, created_at, updated_at, last_sign_in_at, email_confirmed_at,
                confirmation_sent_at, recovery_sent_at, email_change, invited_at,
                banned_until, deleted_at, phone IS NOT NULL AS has_phone
         FROM auth.users
         WHERE lower(email) = lower($1) OR lower(coalesce(email_change, '')) = lower($1)`,
        [EMAIL],
      ),
    ),
  };

  const authIds = Array.isArray(report.authUsers)
    ? report.authUsers.map((row) => String(row.id))
    : [];
  const appIds = Array.isArray(report.appUser)
    ? report.appUser.map((row) => String(row.id))
    : [];

  const rest = {
    sessions: await section("sessions", async () =>
      authIds.length
        ? q(
            `SELECT user_id::text, created_at, updated_at, refreshed_at, not_after,
                    user_agent
             FROM auth.sessions WHERE user_id = ANY($1::uuid[])
             ORDER BY created_at DESC LIMIT 20`,
            [authIds],
          )
        : [],
    ),
    identities: await section("identities", async () =>
      authIds.length
        ? q(
            `SELECT user_id::text, provider, created_at, updated_at, last_sign_in_at
             FROM auth.identities WHERE user_id = ANY($1::uuid[])`,
            [authIds],
          )
        : [],
    ),
    earlyAccess: await section("earlyAccess", () =>
      q(
        `SELECT r.id, r."deliveryStatus"::text AS delivery_status, r."attemptCount",
                r."lastError", r."sentAt", r."skippedReason", r."claimedAt",
                r."createdAt", r."updatedAt", c.key AS campaign_key, c.status::text AS campaign_status
         FROM "WaitlistEarlyAccessRecipient" r
         JOIN "WaitlistEarlyAccessCampaign" c ON c.id = r."campaignId"
         LEFT JOIN "WaitlistUser" w ON w.id = r."waitlistUserId"
         LEFT JOIN "User" u ON u.id = r."testAdminUserId"
         WHERE lower(coalesce(w.email, '')) = lower($1)
            OR lower(coalesce(u.email, '')) = lower($1)`,
        [EMAIL],
      ),
    ),
    onboarding: await section("onboarding", () =>
      q(
        `SELECT id, status::text, "originalEmail", "recipientEmailNorm", "sentAt",
                "claimedAt", "completedAt", "revokedAt", "sendAttemptCount", "lastError", "createdAt"
         FROM "DealerOnboardingInvite"
         WHERE lower("originalEmail") = lower($1) OR lower("recipientEmailNorm") = lower($1)`,
        [EMAIL],
      ),
    ),
    reports: await section("reports", () =>
      q(
        `SELECT id, "listingId", "reporterId", reason, "reasonCode"::text, status::text,
                "createdAt", "closedAt"
         FROM "Report"
         WHERE lower("reporterEmail") = lower($1)
            OR ($2::text[] <> '{}'::text[] AND "reporterId" = ANY($2::text[]))
         ORDER BY "createdAt" DESC LIMIT 20`,
        [EMAIL, appIds],
      ),
    ),
    monitoring: await section("monitoring", () =>
      q(
        `SELECT e.id, e."occurredAt", e.environment, e.source::text, e.severity::text,
                e."userId", e."userEmail", e.route, e.action, e.component, e."requestPath",
                left(e.message, 500) AS message,
                i.status::text AS issue_status, i.title, i.occurrences, i."resolvedAt", i."lastSeenAt"
         FROM "MonitoringEvent" e
         JOIN "MonitoringIssue" i ON i.id = e."issueId"
         WHERE lower(coalesce(e."userEmail", '')) IN (lower($1), lower($2))
            OR e.message ILIKE '%' || $1 || '%'
            OR coalesce(e.extra::text, '') ILIKE '%' || $1 || '%'
            OR coalesce(e.tags::text, '') ILIKE '%' || $1 || '%'
            OR ($3::text[] <> '{}'::text[] AND e."userId" = ANY($3::text[]))
         ORDER BY e."occurredAt" DESC
         LIMIT 50`,
        [EMAIL, MASK, appIds],
      ),
    ),
    adminAudit: await section("adminAudit", () =>
      q(
        `SELECT id, "adminId", action, "entityType", "entityId", "createdAt",
                left(details::text, 700) AS details
         FROM "AdminAuditLog"
         WHERE details::text ILIKE '%' || $1 || '%'
            OR ($2::text[] <> '{}'::text[] AND "entityId" = ANY($2::text[]))
         ORDER BY "createdAt" DESC
         LIMIT 30`,
        [EMAIL, [...appIds, ...authIds]],
      ),
    ),
    activity: await section("activity", async () => {
      if (!appIds.length) return null;
      const [counts] = await q(
        `SELECT
           (SELECT count(*) FROM "Listing" WHERE "userId" = ANY($1::text[]))::int AS listings,
           (SELECT count(*) FROM "Favourite" WHERE "userId" = ANY($1::text[]))::int AS favourites,
           (SELECT count(*) FROM "SavedSearch" WHERE "userId" = ANY($1::text[]))::int AS saved_searches,
           (SELECT count(*) FROM "ListingView" WHERE "viewerId" = ANY($1::text[]))::int AS listing_views,
           (SELECT count(*) FROM "DealerReview" WHERE "reviewerUserId" = ANY($1::text[]))::int AS reviews,
           (SELECT count(*) FROM "PolicyAcceptance" WHERE "userId" = ANY($1::text[]))::int AS policy_acceptances,
           (SELECT count(*) FROM "FreeListingClaim" WHERE "userId" = ANY($1::text[]))::int AS free_claims,
           (SELECT count(*) FROM "DealerProfile" WHERE "userId" = ANY($1::text[]))::int AS dealer_profiles`,
        [appIds],
      );
      const listings = await q(
        `SELECT l.id, l.title, l.status::text, l."createdAt", l."updatedAt", l."soldAt",
                c.name AS category, r.name AS region
         FROM "Listing" l
         JOIN "Category" c ON c.id = l."categoryId"
         JOIN "Region" r ON r.id = l."regionId"
         WHERE l."userId" = ANY($1::text[])
         ORDER BY l."createdAt" DESC`,
        [appIds],
      );
      const policies = await q(
        `SELECT "acceptanceType"::text, "bundleVersion", source::text, "createdAt"
         FROM "PolicyAcceptance" WHERE "userId" = ANY($1::text[])
         ORDER BY "createdAt"`,
        [appIds],
      );
      const dealer = await q(
        `SELECT id, name, slug, tier::text, verified, "createdAt"
         FROM "DealerProfile" WHERE "userId" = ANY($1::text[])`,
        [appIds],
      );
      return { counts, listings, policies, dealer };
    }),
    authAudit: await section("authAudit", () =>
      q(
        `SELECT id, created_at, ip_address::text AS ip,
                payload->>'action' AS action,
                left(payload::text, 900) AS payload
         FROM auth.audit_log_entries
         WHERE payload::text ILIKE '%' || $1 || '%'
         ORDER BY created_at DESC
         LIMIT 40`,
        [EMAIL],
      ),
    ),
    similar: await section("similar", () =>
      q(
        `SELECT 'app_user' AS source, email, "createdAt" AS created_at FROM "User"
         WHERE email ILIKE '%hrogers%' OR email ILIKE '%rogers095%'
         UNION ALL
         SELECT 'waitlist', email, "createdAt" FROM "WaitlistUser"
         WHERE email ILIKE '%hrogers%' OR email ILIKE '%rogers095%'
         UNION ALL
         SELECT 'auth', email, created_at FROM auth.users
         WHERE email ILIKE '%hrogers%' OR email ILIKE '%rogers095%'`,
      ),
    ),
    maskedMonitoringCount: await section("maskedMonitoringCount", () =>
      q(
        `SELECT count(*)::int AS events
         FROM "MonitoringEvent"
         WHERE lower(coalesce("userEmail", '')) = lower($1)`,
        [MASK],
      ),
    ),
  };

  console.log(JSON.stringify({ ...report, ...rest }, null, 2));
} finally {
  await pool.end();
}
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "audit failed");
  process.exitCode = 1;
});
