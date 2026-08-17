import { expect, test } from "@playwright/test";
import { ADMIN_USER } from "./fixtures/test-users";

const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? ADMIN_USER.email;
const E2E_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? ADMIN_USER.password;

test.describe("admin costs", () => {
  test("redirects anonymous visitors away from /admin/costs", async ({ page }) => {
    await page.goto("/admin/costs", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/admin\/costs/);
  });

  test("lets an admin open the costs page and see the invoice control", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
    await page.getByLabel(/^email/i).fill(E2E_ADMIN_EMAIL);
    await page.getByLabel(/^password/i).fill(E2E_ADMIN_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/admin/, { timeout: 30_000 });

    await page.goto("/admin/costs", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Costs" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Costs" })).toBeVisible();
    await expect(page.getByRole("button", { name: /request an invoice for/i })).toBeVisible();
  });
});
