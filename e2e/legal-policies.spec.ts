import { test, expect } from "@playwright/test";

const LEGAL_PAGES = [
  { path: "/privacy", heading: /privacy/i },
  { path: "/cookies", heading: /cookie/i },
  { path: "/terms", heading: /terms/i },
  { path: "/dealer-terms", heading: /dealer/i },
  { path: "/private-seller-terms", heading: /private seller/i },
  { path: "/acceptable-use", heading: /acceptable use/i },
  { path: "/refunds", heading: /refund/i },
  { path: "/vehicle-check-terms", heading: /vehicle check terms/i },
] as const;

test.describe("Legal policies POL-DOC-001", () => {
  for (const pageDef of LEGAL_PAGES) {
    test(`${pageDef.path} renders canonical policy text`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.goto(pageDef.path, { waitUntil: "commit" });
      await expect(page.getByRole("heading", { name: pageDef.heading }).first()).toBeVisible({
        timeout: 45_000,
      });
      await expect(
        page.getByText("Company number: 139244C", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("hello@itrader.im").first()).toBeVisible();
    });
  }

  test("cookie banner offers accept, reject, and manage POL-COOKIE-001", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/privacy", { waitUntil: "commit" });
    await expect(page.getByRole("button", { name: /accept all/i })).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByRole("button", { name: /reject/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /manage/i })).toBeVisible();
  });
});
