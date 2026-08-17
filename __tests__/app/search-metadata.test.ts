import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

const categoryFindFirstMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    category: { findFirst: categoryFindFirstMock },
  },
}));

const { generateMetadata } = await import("@/app/(public)/search/page");

describe("search metadata robots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    categoryFindFirstMock.mockResolvedValue(null);
  });

  it("allows the canonical base search page to index", async () => {
    const metadata = await generateMetadata({
      searchParams: Promise.resolve({ utm_source: "ignored", page: "1" }),
    });

    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.alternates?.canonical).toBe(buildCanonicalUrl("/search"));
  });

  it.each([
    { q: "ford" },
    { page: "2" },
    { region: "douglas" },
    { sort: "newest" },
    { featured: "true" },
    { includeSold: "true" },
    { category: "car", region: "douglas" },
  ])("sets noindex/follow for query, pagination, or filters", async (params) => {
    const metadata = await generateMetadata({
      searchParams: Promise.resolve(params),
    });

    expect(metadata.robots).toEqual({ index: false, follow: true });
  });

  it("indexes an active category-only marketplace landing page", async () => {
    categoryFindFirstMock.mockResolvedValue({ slug: "car" });

    const metadata = await generateMetadata({
      searchParams: Promise.resolve({ category: "car" }),
    });

    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.alternates?.canonical).toBe(
      buildCanonicalUrl("/search?category=car"),
    );
  });

  it("noindexes an invalid category without canonicalizing its junk slug", async () => {
    const metadata = await generateMetadata({
      searchParams: Promise.resolve({ category: "does-not-exist" }),
    });

    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata.alternates?.canonical).toBe(buildCanonicalUrl("/search"));
  });
});
