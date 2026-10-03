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
    await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Daily trend/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Activity/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "30d" })).toHaveAttribute("aria-current", "page");
    const visitorMap = page.getByRole("region", { name: "Visitor locations" });
    const visitorReport = page.getByText(/Google Analytics reporting is not configured|No Google Analytics data in this range|Google Analytics reporting is temporarily unavailable|No cities could be placed on the map/);
    await expect(visitorMap.or(visitorReport)).toBeVisible();
    await page.getByRole("link", { name: "7d" }).click();
    await expect(page.getByRole("link", { name: "7d" })).toHaveAttribute("aria-current", "page");
  });
});
