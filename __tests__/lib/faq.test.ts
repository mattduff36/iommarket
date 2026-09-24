import { describe, expect, it } from "vitest";
import { FAQ_CATEGORIES } from "@/lib/faq/content";
import {
  assertFaqContent,
  countFaqItems,
  faqItemPlainText,
  filterFaqCategories,
  normalizeFaqQuery,
} from "@/lib/faq/search";
import { getDealerListingCap } from "@/lib/config/dealer-tiers";
import { LISTING_DURATION_DAYS } from "@/lib/listing-status";
import {
  FEATURED_LISTING_PHOTO_LIMIT,
  PRIVATE_LISTING_PHOTO_LIMIT,
} from "@/lib/listings/photo-limits";
import { FOOTER_NAV_ITEMS } from "@/lib/navigation";
import { classifyLaunchRoute } from "@/lib/launch/route-class";
import { isPublicPath } from "../../proxy";

function allPlainText(): string {
  return FAQ_CATEGORIES.map((category) =>
    [category.title, ...category.items.map((item) => `${item.question} ${faqItemPlainText(item)}`)].join(
      " ",
    ),
  ).join(" ");
}

describe("FAQ content", () => {
  it("keeps stable, unique ids", () => {
    expect(() => assertFaqContent(FAQ_CATEGORIES)).not.toThrow();
    const ids = FAQ_CATEGORIES.flatMap((category) => [
      category.id,
      ...category.items.map((item) => item.id),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.length > 0)).toBe(true);
  });

  it("covers the public product without a second price list", () => {
    const text = allPlainText();
    const questionCount = countFaqItems(FAQ_CATEGORIES);

    expect(FAQ_CATEGORIES.map((category) => category.title)).toEqual([
      "About iTrader",
      "Buying a Vehicle",
      "Selling Privately",
      "Vehicle Listings",
      "Payments, Featured Listings & Refunds",
      "Dealers",
      "Accounts",
      "Vehicle Check",
      "Safety & Moderation",
      "Support",
    ]);
    expect(questionCount).toBeGreaterThanOrEqual(25);
    expect(questionCount).toBeLessThanOrEqual(40);
    expect(text).toContain(`${LISTING_DURATION_DAYS} days`);
    expect(text).toContain(`${PRIVATE_LISTING_PHOTO_LIMIT} photographs`);
    expect(text).toContain(`${FEATURED_LISTING_PHOTO_LIMIT} photographs`);
    expect(text).toContain(`up to ${getDealerListingCap("STARTER")} active listings`);
    expect(text).toContain(`up to ${getDealerListingCap("PRO")}`);
    expect(text).not.toMatch(/£|4\.99|29\.99|49\.99/);
    expect(text).not.toMatch(/FAQPage|QAPage|rich result|escrow|stock sync/i);
    expect(text).not.toMatch(/iTrader guarantees|we guarantee/i);
    expect(text).toContain("does not guarantee");
    expect(text).toContain("hello@itrader.im");
    expect(text).toContain("DELETE MY ACCOUNT");
    expect(text).not.toMatch(/no button that deletes/i);
    expect(text).toContain("Category N");
  });

  it("links to the public pages a reader may need", () => {
    const hrefs = FAQ_CATEGORIES.flatMap((category) =>
      category.items.flatMap((item) =>
        item.paragraphs.flatMap((paragraph) =>
          paragraph.flatMap((part) => (part.kind === "link" ? [part.href] : [])),
        ),
      ),
    );

    for (const href of [
      "/pricing",
      "/safety",
      "/refunds",
      "/vehicle-check",
      "/vehicle-check-terms",
      "/contact",
      "/acceptable-use",
      "/private-seller-terms",
      "/dealer-terms",
      "/terms",
      "/search",
      "/sell",
      "/dealers",
    ]) {
      expect(hrefs).toContain(href);
    }
  });
});

describe("FAQ search", () => {
  it("matches questions, answers and categories without case or extra space", () => {
    expect(normalizeFaqQuery("  Category N  ")).toBe("category n");
    expect(
      filterFaqCategories(FAQ_CATEGORIES, "  REFUND ").some((category) =>
        category.items.some((item) => item.id === "can-i-get-a-refund"),
      ),
    ).toBe(true);
    expect(
      filterFaqCategories(FAQ_CATEGORIES, "ripple").some((category) =>
        category.items.some((item) => item.id === "what-happens-if-my-payment-fails"),
      ),
    ).toBe(true);
    expect(
      filterFaqCategories(FAQ_CATEGORIES, "moderation").every(
        (category) => category.id === "safety-and-moderation",
      ),
    ).toBe(true);
    expect(filterFaqCategories(FAQ_CATEGORIES, "   ")).toHaveLength(FAQ_CATEGORIES.length);
    expect(filterFaqCategories(FAQ_CATEGORIES, "zzzz-not-a-real-question")).toEqual([]);
  });
});

describe("FAQ discovery", () => {
  it("is public, indexable alongside the other help pages, and in the footer", () => {
    expect(classifyLaunchRoute("/faq")).toBe("legal");
    expect(isPublicPath("/faq")).toBe(true);

    const labels = FOOTER_NAV_ITEMS.map((item) => item.label);
    expect(labels.indexOf("FAQ")).toBe(labels.indexOf("Buyer Safety") + 1);
    expect(labels.indexOf("Contact")).toBe(labels.indexOf("FAQ") + 1);
    expect(FOOTER_NAV_ITEMS.find((item) => item.label === "FAQ")?.href).toBe("/faq");
  });
});
