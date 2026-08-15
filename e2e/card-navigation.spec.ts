import { test, expect, type Page } from "@playwright/test";
import * as dotenv from "dotenv";
import * as path from "path";
import { db } from "../lib/db";
import { getPublicDealerWhere } from "../lib/dealers/access";
import { ADMIN_USER } from "./fixtures/test-users";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? ADMIN_USER.email;
const E2E_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? ADMIN_USER.password;

const createdListingIds: string[] = [];
const createdReportIds: string[] = [];
const createdSubscriptionIds: string[] = [];
const createdDealerProfileIds: string[] = [];

async function dismissCookieBanner(page: Page): Promise<void> {
  const acceptButton = page.getByRole("button", { name: /accept all|^accept$/i });
  if (await acceptButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await acceptButton.click();
  }
}

async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await dismissCookieBanner(page);
  await page.getByRole("textbox", { name: /^email$/i }).fill(E2E_ADMIN_EMAIL, {
    timeout: 20_000,
  });
  await page.getByRole("textbox", { name: /^password$/i }).fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 30_000 });
}

async function createLiveListing(titleSuffix: string) {
  const user = await db.user.findUnique({
    where: { email: E2E_ADMIN_EMAIL },
    select: { id: true },
  });
  if (!user) {
    throw new Error(`E2E admin user not found: ${E2E_ADMIN_EMAIL}`);
  }

  const [category, region] = await Promise.all([
    db.category.findFirst({
      where: { active: true },
      select: { id: true },
      orderBy: { sortOrder: "asc" },
    }),
    db.region.findFirst({
      where: { active: true },
      select: { id: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);

  if (!category || !region) {
    throw new Error("E2E setup missing active category or region");
  }

  const listing = await db.listing.create({
    data: {
      userId: user.id,
      categoryId: category.id,
      regionId: region.id,
      title: `E2E ${titleSuffix} ${Date.now()}`,
      description: "E2E listing used to validate whole-card navigation.",
      price: 1_234_00,
      status: "LIVE",
      trustDeclarationAccepted: true,
      trustDeclarationAcceptedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    select: { id: true, title: true },
  });

  createdListingIds.push(listing.id);
  return listing;
}

async function ensurePublicDealer() {
  const existing = await db.dealerProfile.findFirst({
    where: getPublicDealerWhere(),
    select: { id: true, name: true, slug: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) {
    return existing;
  }

  const user = await db.user.findUnique({
    where: { email: E2E_ADMIN_EMAIL },
    select: {
      id: true,
      dealerProfile: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!user) {
    throw new Error(`E2E admin user not found: ${E2E_ADMIN_EMAIL}`);
  }

  let dealer = user.dealerProfile;
  if (!dealer) {
    dealer = await db.dealerProfile.create({
      data: {
        userId: user.id,
        name: `E2E WCARD Dealer ${Date.now()}`,
        slug: `e2e-wcard-${Date.now()}`,
      },
      select: { id: true, name: true, slug: true },
    });
    createdDealerProfileIds.push(dealer.id);
  }

  const subscription = await db.subscription.create({
    data: {
      dealerId: dealer.id,
      paymentProvider: "ADMIN",
      source: "ADMIN_GRANT",
      status: "ACTIVE",
      grantStartsAt: new Date(Date.now() - 60_000),
      grantEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });
  createdSubscriptionIds.push(subscription.id);
  return dealer;
}

test.describe("Card navigation", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "WCARD-03 is desktop-only");
  });

  test.afterEach(async () => {
    if (createdReportIds.length > 0) {
      await db.report.deleteMany({ where: { id: { in: createdReportIds } } });
      createdReportIds.length = 0;
    }
    if (createdListingIds.length > 0) {
      await db.favourite.deleteMany({
        where: { listingId: { in: createdListingIds } },
      });
      await db.listing.deleteMany({ where: { id: { in: createdListingIds } } });
      createdListingIds.length = 0;
    }
    if (createdSubscriptionIds.length > 0) {
      await db.subscription.deleteMany({
        where: { id: { in: createdSubscriptionIds } },
      });
      createdSubscriptionIds.length = 0;
    }
    if (createdDealerProfileIds.length > 0) {
      await db.dealerProfile.deleteMany({
        where: { id: { in: createdDealerProfileIds } },
      });
      createdDealerProfileIds.length = 0;
    }
  });

  test("listing card body click and Enter open the listing", async ({ page }) => {
    test.setTimeout(90_000);
    const listing = await createLiveListing("Card Nav");

    await page.goto("/search?sort=newest", { waitUntil: "domcontentloaded" });
    await dismissCookieBanner(page);

    const card = page.getByRole("article", { name: listing.title });
    await expect(card).toBeVisible({ timeout: 45_000 });
    await card.getByRole("link", { name: listing.title }).click();
    await expect(page).toHaveURL(new RegExp(`/listings/${listing.id}`));

    await page.goto("/search?sort=newest", { waitUntil: "domcontentloaded" });
    const overlay = page
      .getByRole("article", { name: listing.title })
      .getByRole("link", { name: listing.title });
    await expect(overlay).toBeAttached({ timeout: 45_000 });
    await overlay.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/listings/${listing.id}`));
  });

  test("listing favourite control does not navigate", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/uidemo", { waitUntil: "domcontentloaded" });
    await dismissCookieBanner(page);

    const card = page.getByRole("article", {
      name: "Vintage Rolex Submariner 1968",
    });
    await expect(card).toBeVisible({ timeout: 45_000 });
    await card.getByRole("button", { name: /save to favourites/i }).click();
    await expect(page).toHaveURL(/\/uidemo/);
    await expect(card).toBeVisible();
  });

  test("dealer card body click and Enter open the profile", async ({ page }) => {
    test.setTimeout(60_000);
    const dealer = await ensurePublicDealer();

    await page.goto("/dealers", { waitUntil: "domcontentloaded" });
    await dismissCookieBanner(page);

    const dealerLink = page.getByRole("link", {
      name: `Visit ${dealer.name} profile`,
    });
    await expect(dealerLink).toBeVisible({ timeout: 45_000 });
    await dealerLink.click();
    await expect(page).toHaveURL((url) => url.pathname === `/dealers/${dealer.slug}`);

    await page.goto("/dealers", { waitUntil: "domcontentloaded" });
    const focusedLink = page.getByRole("link", {
      name: `Visit ${dealer.name} profile`,
    });
    await focusedLink.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL((url) => url.pathname === `/dealers/${dealer.slug}`);
  });

  test("admin report moderation control does not navigate", async ({ page }) => {
    test.setTimeout(90_000);
    const listing = await createLiveListing("Report Card");
    const report = await db.report.create({
      data: {
        listingId: listing.id,
        reporterEmail: "e2e-wcard@example.com",
        reason: "E2E whole-card navigation isolation for report moderation.",
        status: "OPEN",
      },
      select: { id: true },
    });
    createdReportIds.push(report.id);

    await signInAsAdmin(page);
    await page.goto("/admin/reports", { waitUntil: "domcontentloaded" });
    await dismissCookieBanner(page);

    const overlay = page.getByRole("link", { name: listing.title });
    await expect(overlay).toBeVisible({ timeout: 45_000 });
    const card = page.locator("div.relative").filter({ has: overlay });
    await card.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/admin\/reports/);
    await expect(overlay).toBeVisible();
  });
});
