import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setNodeEnv } from "@/__tests__/lib/seo-test-env";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

const categoryFindFirstMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    category: { findFirst: categoryFindFirstMock },
  },
}));

const { generateMetadata } = await import("@/app/(public)/search/page");

describe("search metadata robots", () => {
  const originalNode = process.env.NODE_ENV;
  const originalVercel = process.env.VERCEL_ENV;
  const originalLaunch = process.env.PRODUCTION_LAUNCH_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    categoryFindFirstMock.mockResolvedValue(null);
    setNodeEnv("production");
    process.env.VERCEL_ENV = "production";
    process.env.PRODUCTION_LAUNCH_ENABLED = "1";
    process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
  });

  afterEach(() => {
    setNodeEnv(originalNode);
    if (originalVercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercel;
    if (originalLaunch === undefined) delete process.env.PRODUCTION_LAUNCH_ENABLED;
    else process.env.PRODUCTION_LAUNCH_ENABLED = originalLaunch;
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
    expect(metadata.title).toBe("Cars for sale");
    expect(metadata.alternates?.canonical).toBe(
      buildCanonicalUrl("/search?category=car"),
    );
    const images = metadata.openGraph?.images;
    const image = Array.isArray(images) ? images[0] : images;
    expect(image).toMatchObject({ url: "/og/itrader-social.png", width: 1200, height: 630 });
  });

  it("noindexes a category page on preview even when the category is valid", async () => {
    process.env.VERCEL_ENV = "preview";
    categoryFindFirstMock.mockResolvedValue({ slug: "car", name: "Cars" });
    const metadata = await generateMetadata({
      searchParams: Promise.resolve({ category: "car" }),
    });
    expect(metadata.robots).toEqual({ index: false, follow: true });
  });

  it("noindexes an invalid category without canonicalizing its junk slug", async () => {
    const metadata = await generateMetadata({
      searchParams: Promise.resolve({ category: "does-not-exist" }),
    });

    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata.alternates?.canonical).toBe(buildCanonicalUrl("/search"));
  });
});
