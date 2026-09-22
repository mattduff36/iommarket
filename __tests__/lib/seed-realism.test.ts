import { describe, expect, it } from "vitest";
import { LISTING_DURATION_DAYS } from "../../lib/listing-status";
import { LIVE_COUNT, SOLD_COUNT } from "../../prisma/seed/constants";
import { BLOCKED_SAMPLE_NAMES } from "../../prisma/seed/copy";
import { buildMarketplacePlan } from "../../prisma/seed/dataset";
import { assertOriginalSampleImages } from "../../prisma/seed/photos";
import { LIVE_MAX_AGE_DAYS } from "../../prisma/seed/timeline";

const NOW = new Date("2026-09-04T12:00:00.000Z");

describe("SEED-REALISM-001", () => {
  const plan = buildMarketplacePlan({
    preservedDealers: [],
    preservedUsers: [
      {
        id: "admin-1",
        email: "admin@mpdee.co.uk",
        name: "Admin",
        role: "ADMIN",
      },
      {
        id: "admin-2",
        email: "d.p.marshall@hotmail.co.uk",
        name: "Dave",
        role: "ADMIN",
      },
    ],
    now: NOW,
  });

  it("uses unique IOM copy, matched photos, and a year of history", () => {
    const descriptions = plan.listings.map((listing) => listing.description);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    expect(
      plan.listings.some((listing) =>
        listing.description.includes("strong condition for island use"),
      ),
    ).toBe(false);

    const live = plan.listings.filter((listing) => listing.status === "LIVE");
    const sold = plan.listings.filter((listing) => listing.status === "SOLD");
    const expired = plan.listings.filter((listing) => listing.status === "EXPIRED");
    expect(live).toHaveLength(LIVE_COUNT);
    expect(sold).toHaveLength(SOLD_COUNT);
    expect(live.every((listing) => listing.daysAgo <= LIVE_MAX_AGE_DAYS)).toBe(true);
    expect(live.every((listing) => (listing.expiresOffsetDays ?? 0) > 0)).toBe(true);
    expect(Math.max(...sold.map((listing) => listing.daysAgo), ...expired.map((listing) => listing.daysAgo))).toBeGreaterThanOrEqual(300);

    for (const listing of [...live, ...sold, ...plan.listings.filter((row) => row.status === "PENDING")]) {
      expect(listing.imageUrls).toHaveLength(5);
      assertOriginalSampleImages(listing.imageUrls);
      expect(
        listing.imageUrls.slice(1).every((url) => url.startsWith("https://res.cloudinary.com/")),
      ).toBe(true);
    }

    expect(plan.dealers.some((dealer) => BLOCKED_SAMPLE_NAMES.includes(dealer.name as (typeof BLOCKED_SAMPLE_NAMES)[number]))).toBe(false);
    expect(plan.dealers.some((dealer) => dealer.slug === "morris-motors")).toBe(false);
    expect(plan.sellers.some((seller) => seller.key === plan.listings.find((row) => row.key === "draft-001")?.sellerKey)).toBe(true);
    expect(live.every((listing) => (listing.expiresOffsetDays ?? 0) <= LISTING_DURATION_DAYS)).toBe(true);

    const featured = plan.listings.filter((listing) => listing.featured);
    const featuredHeroes = featured.map((listing) => listing.imageUrls[0]);
    expect(featured.every((listing) => listing.status === "LIVE")).toBe(true);
    expect(featuredHeroes).toHaveLength(new Set(featuredHeroes).size);
    expect(plan.listings.filter((listing) => listing.status !== "LIVE" && listing.featured)).toHaveLength(0);

    const cars = plan.listings.filter((listing) => listing.category === "car").length;
    expect(cars / plan.listings.length).toBeGreaterThanOrEqual(0.65);
    expect(cars / plan.listings.length).toBeLessThanOrEqual(0.75);
  });
});
