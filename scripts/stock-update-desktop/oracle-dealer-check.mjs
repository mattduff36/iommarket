import { chromium } from "@playwright/test";

// Public read only. Require stock evidence from the same headed source as the registry.
const browser = await chromium.launch({ headless: false });
try {
  const page = await browser.newPage({ locale: "en-GB", viewport: { width: 1440, height: 1100 } });
  const response = await page.goto("https://www.mikesmotors.im/used-cars", {
    waitUntil: "domcontentloaded", timeout: 30000,
  });
  const listings = page.locator(".listing, .results-vehicleresults");
  await listings.first().waitFor({ state: "attached", timeout: 20000 });
  const details = await page.locator("a[href]").evaluateAll(links =>
    new Set(links.map(link => link.href).filter(href => /\/used-[^/]+-isle-of-man-\d+/i.test(href))).size);
  const listingElements = await listings.count();
  console.log(JSON.stringify({ status: response?.status(), title: await page.title(), listingElements, detailLinks: details }));
  if (!response?.ok() || !listingElements || !details) process.exitCode = 1;
} finally {
  await browser.close();
}
