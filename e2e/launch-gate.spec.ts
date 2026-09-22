import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ timeout: 90_000 });

test("keeps a gated runtime closed, readable to crawlers, and zoomable", async ({ page }) => {
  const search = await page.request.get("/api/search");
  expect(search.status()).toBe(503);
  expect(await search.json()).toEqual({ error: "Service unavailable" });

  const cron = await page.request.get("/api/cron/cost-maintenance");
  expect(cron.status()).toBe(401);

  const robots = await page.request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  const robotsText = await robots.text();
  expect(robotsText).toContain("Disallow: /");
  expect(robotsText).not.toContain("Sitemap:");

  const sitemap = await page.request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).not.toContain("/listings/");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("Under Construction")).toBeVisible();
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewport ?? "").not.toMatch(/maximum-scale/i);
  expect(viewport ?? "").not.toMatch(/user-scalable\s*=\s*no/i);
});

test("a signed gate session unlocks catalogue APIs without a preview redirect", async ({ page }) => {
  const devPass = process.env.DEV_PASS;
  test.skip(!devPass, "DEV_PASS is not configured");

  const unlocked = await page.request.post("/api/dev-auth", {
    data: { password: devPass },
  });
  expect(unlocked.status()).toBe(200);
  const setCookie = unlocked.headers()["set-cookie"] ?? "";
  const token = setCookie.split("__Host-dev-gate=")[1]?.split(";")[0];
  expect(token).toBeTruthy();

  const search = await page.request.get("/api/search", {
    headers: { cookie: `__Host-dev-gate=${token}` },
  });
  expect(search.status()).not.toBe(503);
});
