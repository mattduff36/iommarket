import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
  categoryFindFirst: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}));

vi.mock("@/lib/db", () => ({
  db: {
    category: { findFirst: mocks.categoryFindFirst },
  },
}));

const { default: CategoryPage } = await import(
  "@/app/(public)/categories/[slug]/page"
);

describe("category redirect route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects using the active category slug returned by the database", async () => {
    mocks.categoryFindFirst.mockResolvedValue({ slug: "classic-cars" });

    await expect(
      CategoryPage({
        params: Promise.resolve({ slug: "legacy-category-route" }),
      }),
    ).rejects.toThrow(
      "redirect:/search?category=classic-cars",
    );
    expect(mocks.categoryFindFirst).toHaveBeenCalledWith({
      where: { slug: "legacy-category-route", active: true },
      select: { slug: true },
    });
  });

  it.each(["unknown", ""])("returns not found for unknown or blank slugs", async (slug) => {
    mocks.categoryFindFirst.mockResolvedValue(null);

    await expect(
      CategoryPage({ params: Promise.resolve({ slug }) }),
    ).rejects.toThrow("notFound");
    expect(mocks.redirect).not.toHaveBeenCalled();
    if (!slug) {
      expect(mocks.categoryFindFirst).not.toHaveBeenCalled();
    }
  });
});
