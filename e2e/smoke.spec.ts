import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Smoke tests for itrader.im MVP
// Run: npx playwright test
// ---------------------------------------------------------------------------

test.describe("Public pages", () => {
  test("home page loads and shows hero", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /trusted marketplace/i })
    ).toBeVisible();
  });

  test("home page shows category links", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Browse Categories")).toBeVisible();
  });

  test("categories page loads", async ({ page }) => {
    await page.goto("/categories");
    await expect(
      page.getByRole("heading", { name: /categories/i })
    ).toBeVisible();
  });

  test("search page loads with no query", async ({ page }) => {
    await page.goto("/search");
    await expect(
      page.getByRole("heading", { name: /all listings/i })
    ).toBeVisible();
  });

  test("search page shows results count", async ({ page }) => {
    await page.goto("/search");
    await expect(page.getByText(/result/i)).toBeVisible();
  });

  test("pricing page loads", async ({ page }) => {
    await page.goto("/pricing");
    await expect(
      page.getByRole("heading", { name: /pricing/i })
    ).toBeVisible();
    await expect(page.getByText("£4.99")).toBeVisible();
    await expect(page.getByText("£29.99")).toBeVisible();
  });
});

test.describe("Search and filters", () => {
  test("search with query shows results heading", async ({ page }) => {
    await page.goto("/search?q=car");
    await expect(
      page.getByRole("heading", { name: /results for "car"/i })
    ).toBeVisible();
  });

  test("search with category filter updates URL", async ({ page }) => {
    await page.goto("/search?category=vehicles");
    expect(page.url()).toContain("category=vehicles");
  });

  test("search with price filter updates URL", async ({ page }) => {
    await page.goto("/search?minPrice=1000&maxPrice=50000");
    expect(page.url()).toContain("minPrice=1000");
    expect(page.url()).toContain("maxPrice=50000");
  });
});

test.describe("Navigation", () => {
  test("header contains main nav links", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Home" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Categories" })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Sell" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Pricing" })).toBeVisible();
  });

  test("footer contains footer links", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Terms" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Privacy" })).toBeVisible();
  });
});

test.describe("Listing detail", () => {
  test("non-existent listing returns 404", async ({ page }) => {
    const response = await page.goto("/listings/non-existent-id-123");
    expect(response?.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// NOTE: Full end-to-end listing creation → payment → approval → visibility
// requires:
// 1. A running database with seed data
// 2. Clerk auth configured (or mocked)
// 3. Stripe test mode with CLI for webhook testing
//
// Stripe webhook testing:
//   stripe listen --forward-to localhost:3000/api/webhooks/stripe
//   stripe trigger checkout.session.completed
//
// These smoke tests cover the public-facing pages without auth.
// Full E2E tests with auth + payment should be run in a staging environment.
// ---------------------------------------------------------------------------
