import { expect, test } from "@playwright/test";
import { ADMIN_USER } from "./fixtures/test-users";

const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? ADMIN_USER.email;
const E2E_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? ADMIN_USER.password;

test.describe("admin monitoring and analytics", () => {
  test("redirects anonymous visitors away from monitoring and analytics", async ({ page }) => {
    await page.goto("/admin/monitoring", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/admin\/monitoring/);
    await page.goto("/admin/analytics", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/admin\/analytics/);
  });

  test("lets an admin review pipeline health and activity totals", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
    await page.getByLabel(/^email/i).fill(E2E_ADMIN_EMAIL);
    await page.getByLabel(/^password/i).fill(E2E_ADMIN_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/admin/, { timeout: 30_000 });

    await page.goto("/admin/monitoring", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Monitoring" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Monitoring health" })).toBeVisible();

    await page.goto("/admin/analytics", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Activity and conversion" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Consented visitor analytics" })).toBeVisible();
  });
});
