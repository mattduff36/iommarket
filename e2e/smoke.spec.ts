import { test, expect } from "@playwright/test";

test.describe("Home page", () => {
  test("loads and shows hero logo", async ({ page }) => {
    await page.goto("/", { waitUntil: "commit" });
    await expect(
      page.getByRole("main").getByAltText(/iTrader\.im/i)
    ).toBeVisible({ timeout: 30_000 });
  });

  test("shows search form with Make label", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/", { waitUntil: "commit" });
    await expect(
      page.getByText("Make", { exact: true }).first()
    ).toBeVisible({ timeout: 45_000 });
  });
});

test.describe("Static pages", () => {
  test("pricing page loads", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/pricing", { waitUntil: "commit" });
    await expect(
      page.getByRole("heading", { name: /pricing/i })
    ).toBeVisible({ timeout: 45_000 });
  });

  test("categories page loads", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/categories", { waitUntil: "commit" });
    await expect(
      page.getByRole("heading", { name: /categories/i })
    ).toBeVisible({ timeout: 45_000 });
  });
});

test.describe("Navigation", () => {
  test("navigation links are accessible", async ({ page, viewport }) => {
    test.setTimeout(60_000);
    await page.goto("/pricing", { waitUntil: "commit" });
    const isMobileViewport = (viewport?.width ?? 1280) < 768;

    if (isMobileViewport) {
      const menuBtn = page.getByLabel(/toggle menu/i);
      await expect(menuBtn).toBeVisible({ timeout: 45_000 });
      await menuBtn.click();
      await expect(
        page.getByRole("link", { name: "Home" }).first()
      ).toBeVisible({ timeout: 5_000 });
    } else {
      await expect(
        page.getByRole("navigation", { name: /main/i }).getByRole("link", { name: "Home" })
      ).toBeVisible({ timeout: 45_000 });
    }
  });

  test("footer links are present", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/pricing", { waitUntil: "commit" });
    const footer = page.locator("footer");
    await expect(footer).toBeVisible({ timeout: 45_000 });
    await footer.scrollIntoViewIfNeeded();
    await expect(footer.getByRole("link", { name: "Terms" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Privacy" })).toBeVisible();
  });
});

test.describe("Layout sanity – no horizontal overflow", () => {
  const PAGES = ["/", "/categories", "/pricing"];

  for (const path of PAGES) {
    test(`${path}`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });

      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth + 2;
      });

      expect(hasOverflow).toBe(false);
    });
  }
});

test.describe("Marketplace journey", () => {
  test("home -> search -> listing detail", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.goto("/search", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /all listings|results/i }).first()
    ).toBeVisible();

    const firstListing = page.locator("a[href^='/listings/']").first();
    await expect(firstListing).toBeVisible();
    await firstListing.click();

    await expect(page).toHaveURL(/\/listings\//);
    await expect(
      page.getByRole("heading", { level: 1 })
    ).toBeVisible();
  });
});
