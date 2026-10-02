import { expect, test } from "@playwright/test";

test.describe("checkout window handoff", () => {
  test("keeps a failed payment popup open for retry", async ({ page }) => {
    await page.goto("/pay/failed", { waitUntil: "domcontentloaded" });
    const popupPromise = page.waitForEvent("popup");
    await page.evaluate(() => {
      window.open("/pay/failed", "_blank");
    });
    const popup = await popupPromise;
    await expect(popup.getByRole("heading", { name: /wasn't completed/i })).toBeVisible();
    await popup.waitForTimeout(1_000);
    expect(popup.isClosed()).toBe(false);
    await expect(popup.getByRole("link", { name: /return to my listings/i })).toBeVisible();
  });

  test("does not close an unconfirmed success return", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const popupPromise = page.waitForEvent("popup");
    await page.evaluate(() => {
      window.open("/pay/success", "_blank");
    });
    const popup = await popupPromise;
    await expect(popup.getByRole("heading", { name: /you're back from checkout/i })).toBeVisible();
    await popup.waitForTimeout(1_000);
    expect(popup.isClosed()).toBe(false);
    await expect(popup.getByRole("link", { name: /return to my listings/i })).toBeVisible();
  });
});
