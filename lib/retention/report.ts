import { db } from "@/lib/db";
import { SETTING_KEYS, getSetting } from "@/lib/config/site-settings";
import {
  RETENTION_ENTITY_TYPES,
  getPolicyFlags,
  type RetentionEntityType,
} from "@/lib/policy/flags";
import {
  dealerReviewRetentionDeleteSql,
  listingRetentionUpdateSql,
  listingViewRetentionDeleteSql,
  reportRetentionUpdateSql,
  waitlistRetentionAnonymiseSql,
  waitlistRetentionDeleteSql,
} from "@/lib/retention/mutate-sql";

const DAY_MS = 24 * 60 * 60 * 1000;
const LISTING_MONTHS = 24;
const VIEW_DAYS = 90;
const REPORT_MONTHS = 24;
const REVIEW_MONTHS = 24;
const WAITLIST_ANONYMISE_DAYS = 30;
const WAITLIST_DELETE_MONTHS = 24;

function monthsAgo(months: number, now: Date) {
  return addCalendarMonths(now, -months);
}

export function addCalendarMonths(date: Date, months: number) {
  const next = new Date(date);
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, lastDay));
  return next;
}

export function isWaitlistAnonymiseWindowOpen(
  campaignClosedAt: Date,
  now: Date,
) {
  return (
    now.getTime() >=
    campaignClosedAt.getTime() + WAITLIST_ANONYMISE_DAYS * DAY_MS
  );
}

export function isWaitlistDeleteWindowOpen(
  campaignClosedAt: Date,
  now: Date,
) {
  return (
    now.getTime() >=
    addCalendarMonths(campaignClosedAt, WAITLIST_DELETE_MONTHS).getTime()
  );
}

async function heldIds(entityType: string) {
  const holds = await db.retentionLegalHold.findMany({
    where: { entityType, releasedAt: null },
    select: { entityId: true },
  });
  return new Set(holds.map((hold) => hold.entityId));
}

export async function collectRetentionCandidates(now = new Date()) {
  const listingCutoff = monthsAgo(LISTING_MONTHS, now);
  const viewCutoff = new Date(now.getTime() - VIEW_DAYS * DAY_MS);
  const reportCutoff = monthsAgo(REPORT_MONTHS, now);
  const reviewCutoff = monthsAgo(REVIEW_MONTHS, now);
  const campaignClosedRaw = await getSetting<string | null>(
    SETTING_KEYS.WAITLIST_CAMPAIGN_CLOSED_AT,
    null,
  );
  const campaignClosedAt = campaignClosedRaw
    ? new Date(campaignClosedRaw)
    : null;

  const [
    listingHolds,
    viewHolds,
    reportHolds,
    reviewHolds,
    waitlistHolds,
    listings,
    views,
    reports,
    reviews,
    waitlist,
  ] = await Promise.all([
    heldIds("LISTING"),
    heldIds("LISTING_VIEW"),
    heldIds("REPORT"),
    heldIds("DEALER_REVIEW"),
    heldIds("WAITLIST_USER"),
    db.listing.findMany({
      where: {
        retentionPurgedAt: null,
        status: { in: ["EXPIRED", "TAKEN_DOWN", "REJECTED", "SOLD"] },
        OR: [
          { expiresAt: { lte: listingCutoff } },
          { soldAt: { lte: listingCutoff } },
          { updatedAt: { lte: listingCutoff } },
        ],
      },
      select: { id: true },
      take: 500,
    }),
    db.listingView.findMany({
      where: { createdAt: { lte: viewCutoff } },
      select: { id: true },
      take: 500,
    }),
    db.report.findMany({
      where: { closedAt: { lte: reportCutoff } },
      select: { id: true },
      take: 500,
    }),
    db.dealerReview.findMany({
      where: { removedAt: { lte: reviewCutoff } },
      select: { id: true },
      take: 500,
    }),
    campaignClosedAt &&
    isWaitlistAnonymiseWindowOpen(campaignClosedAt, now)
      ? db.waitlistUser.findMany({
          where: { deletedAt: null },
          select: { id: true, email: true, createdAt: true },
          take: 500,
        })
      : Promise.resolve([]),
  ]);

  const waitlistDeleteCutoff =
    campaignClosedAt && isWaitlistDeleteWindowOpen(campaignClosedAt, now)
      ? now
      : null;

  return {
    LISTING: listings.filter((row) => !listingHolds.has(row.id)).map((row) => row.id),
    LISTING_VIEW: views.filter((row) => !viewHolds.has(row.id)).map((row) => row.id),
    REPORT: reports.filter((row) => !reportHolds.has(row.id)).map((row) => row.id),
    DEALER_REVIEW: reviews
      .filter((row) => !reviewHolds.has(row.id))
      .map((row) => row.id),
    WAITLIST_USER: waitlist
      .filter((row) => !waitlistHolds.has(row.id))
      .map((row) => row.id),
    waitlistDeleteIds: waitlistDeleteCutoff
      ? waitlist
          .filter((row) => !waitlistHolds.has(row.id))
          .map((row) => row.id)
      : [],
  };
}

async function mutateRetention(
  entityType: RetentionEntityType,
  ids: string[],
  extra?: { waitlistDeleteIds?: string[] },
) {
  if (ids.length === 0) return 0;
  const now = new Date();
  if (entityType === "LISTING") {
    return db.$executeRaw(listingRetentionUpdateSql(ids, now));
  }
  if (entityType === "LISTING_VIEW") {
    return db.$executeRaw(listingViewRetentionDeleteSql(ids));
  }
  if (entityType === "REPORT") {
    return db.$executeRaw(reportRetentionUpdateSql(ids));
  }
  if (entityType === "DEALER_REVIEW") {
    return db.$executeRaw(dealerReviewRetentionDeleteSql(ids));
  }
  if (entityType === "WAITLIST_USER") {
    const deleteIds = extra?.waitlistDeleteIds ?? [];
    if (deleteIds.length > 0) {
      await db.$executeRaw(waitlistRetentionDeleteSql(deleteIds));
    }
    const remaining = ids.filter((id) => !deleteIds.includes(id));
    if (remaining.length > 0) {
      await db.$executeRaw(waitlistRetentionAnonymiseSql(remaining, now));
    }
    return ids.length;
  }
  return 0;
}

export async function runRetentionPass(now = new Date()) {
  const flags = getPolicyFlags();
  const started = await db.retentionRun.create({
    data: {
      mode: flags.canMutateRetention ? "mutate" : "report",
      entityTypes: flags.canMutateRetention
        ? [...flags.retentionEntityAllowlist]
        : [...RETENTION_ENTITY_TYPES],
      status: "RUNNING",
    },
  });

  try {
    const candidates = await collectRetentionCandidates(now);
    const counts: Record<string, number> = {
      LISTING: candidates.LISTING.length,
      LISTING_VIEW: candidates.LISTING_VIEW.length,
      REPORT: candidates.REPORT.length,
      DEALER_REVIEW: candidates.DEALER_REVIEW.length,
      WAITLIST_USER: candidates.WAITLIST_USER.length,
    };
    const sampleIds: Record<string, string[]> = {
      LISTING: candidates.LISTING.slice(0, 10),
      LISTING_VIEW: candidates.LISTING_VIEW.slice(0, 10),
      REPORT: candidates.REPORT.slice(0, 10),
      DEALER_REVIEW: candidates.DEALER_REVIEW.slice(0, 10),
      WAITLIST_USER: candidates.WAITLIST_USER.slice(0, 10),
    };

    if (flags.canMutateRetention) {
      for (const entityType of flags.retentionEntityAllowlist) {
        if (entityType === "MONITORING") continue;
        const ids =
          entityType === "LISTING"
            ? candidates.LISTING
            : entityType === "LISTING_VIEW"
              ? candidates.LISTING_VIEW
              : entityType === "REPORT"
                ? candidates.REPORT
                : entityType === "DEALER_REVIEW"
                  ? candidates.DEALER_REVIEW
                  : entityType === "WAITLIST_USER"
                    ? candidates.WAITLIST_USER
                    : [];
        await mutateRetention(entityType, ids, {
          waitlistDeleteIds: candidates.waitlistDeleteIds,
        });
      }
    }

    await db.retentionRun.update({
      where: { id: started.id },
      data: {
        status: "COMPLETED",
        counts,
        sampleIds,
        completedAt: new Date(),
      },
    });
    return { id: started.id, mode: flags.canMutateRetention ? "mutate" : "report", counts };
  } catch (error) {
    await db.retentionRun.update({
      where: { id: started.id },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Retention run failed",
        completedAt: new Date(),
      },
    });
    throw error;
  }
}
