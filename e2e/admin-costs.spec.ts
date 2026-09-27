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
    await expect(
      page.getByText(/Opening it does not refresh provider charges/i),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: /request an invoice for/i })).toBeVisible();

    const usage = page.getByRole("heading", { name: "Usage" });
    if (await usage.isVisible()) {
      await expect(page.getByRole("img", { name: /cumulative project costs/i })).toBeVisible();
      await expect(page.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "7d" }).click();
      await expect(page.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "All" }).click();
    }
  });
});
