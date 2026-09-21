import { expect, test } from "@playwright/test";

test.describe("dealer onboarding invitation", () => {
  test("explains an invitation link that has no token", async ({ page }) => {
    await page.goto("/dealer/onboarding/claim", { waitUntil: "commit" });
    await expect(page.getByRole("heading", { name: /claim your dealer account/i })).toBeVisible();
    await expect(page.getByText(/not valid/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /continue securely/i })).toHaveCount(0);
  });

  test("asks for the invitation email before documents can be accepted", async ({ page }) => {
    await page.goto("/dealer/onboarding/accept", { waitUntil: "commit" });
    await expect(page.getByRole("heading", { name: /invitation email/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /accept and activate/i })).toHaveCount(0);
  });
});
