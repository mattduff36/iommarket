import { Prisma } from "@prisma/client";

function notHeld(entityType: string) {
  return Prisma.sql`NOT EXISTS (
    SELECT 1 FROM "RetentionLegalHold" h
    WHERE h."entityType" = ${entityType}
      AND h."entityId" = t.id
      AND h."releasedAt" IS NULL
  )`;
}

function idList(ids: string[]) {
  return Prisma.join(ids);
}

export function listingRetentionUpdateSql(ids: string[], now: Date) {
  return Prisma.sql`
    UPDATE "Listing" AS t
    SET
      title = ${"Removed listing"},
      description = ${"This listing was removed under the retention schedule."},
      "retentionPurgedAt" = ${now}
    WHERE t.id IN (${idList(ids)})
      AND ${notHeld("LISTING")}
  `;
}

export function listingViewRetentionDeleteSql(ids: string[]) {
  return Prisma.sql`
    DELETE FROM "ListingView" AS t
    WHERE t.id IN (${idList(ids)})
      AND ${notHeld("LISTING_VIEW")}
  `;
}

export function reportRetentionUpdateSql(ids: string[]) {
  return Prisma.sql`
    UPDATE "Report" AS t
    SET
      "reporterEmail" = ${"redacted@invalid.local"},
      reason = ${"Redacted"}
    WHERE t.id IN (${idList(ids)})
      AND ${notHeld("REPORT")}
  `;
}

export function dealerReviewRetentionDeleteSql(ids: string[]) {
  return Prisma.sql`
    DELETE FROM "DealerReview" AS t
    WHERE t.id IN (${idList(ids)})
      AND ${notHeld("DEALER_REVIEW")}
  `;
}

export function waitlistRetentionDeleteSql(ids: string[]) {
  return Prisma.sql`
    DELETE FROM "WaitlistUser" AS t
    WHERE t.id IN (${idList(ids)})
      AND ${notHeld("WAITLIST_USER")}
  `;
}

export function waitlistRetentionAnonymiseSql(ids: string[], now: Date) {
  return Prisma.sql`
    UPDATE "WaitlistUser" AS t
    SET
      email = 'deleted+' || t.id || '@invalid.local',
      interests = CAST('[]' AS JSONB),
      "marketingWithdrawnAt" = ${now}
    WHERE t.id IN (${idList(ids)})
      AND ${notHeld("WAITLIST_USER")}
  `;
}

export function sqlHasAtomicHoldExclusion(sql: Prisma.Sql) {
  const text = sql.strings.join(" ");
  return (
    text.includes("NOT EXISTS") &&
    text.includes("RetentionLegalHold") &&
    text.includes("releasedAt")
  );
}
