import { test, expect, type Page } from "@playwright/test";
import { db } from "../lib/db";
import { ADMIN_USER } from "./fixtures/test-users";

const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? ADMIN_USER.email;
const E2E_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? ADMIN_USER.password;

const createdListingIds: string[] = [];

async function dismissCookieBanner(page: Page): Promise<void> {
  const acceptButton = page.getByRole("button", { name: /^accept$/i });
  if (await acceptButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await acceptButton.click();
  }
}

async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await dismissCookieBanner(page);
  await page.waitForLoadState("networkidle");

  await page.getByLabel(/^email$/i).fill(E2E_ADMIN_EMAIL);
  await page.getByLabel(/^password$/i).fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 30_000 });
}

async function createListingForE2E(params: {
  status: "DRAFT" | "LIVE" | "PENDING";
  titleSuffix: string;
}) {
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
      orderBy: { name: "asc" },
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
      title: `E2E ${params.titleSuffix} ${Date.now()}`,
      description:
        "E2E listing used to validate checkout handoff, moderation visibility, and report flow.",
      price: 1_234_00,
      status: params.status,
      trustDeclarationAccepted: true,
      trustDeclarationAcceptedAt: new Date(),
      expiresAt:
        params.status === "LIVE"
          ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          : null,
    },
    select: { id: true, title: true },
  });

  createdListingIds.push(listing.id);
  return listing;
}

test.afterEach(async () => {
  if (createdListingIds.length === 0) return;

  await db.listing.deleteMany({
    where: { id: { in: createdListingIds } },
  });
  createdListingIds.length = 0;
});

test.describe("Critical launch funnels", () => {
  test("sell flow: private wizard -> checkout handoff -> moderation visibility", async ({ page }) => {
    const listing = await createListingForE2E({
      status: "DRAFT",
      titleSuffix: "Checkout Handoff",
    });

    await signInAsAdmin(page);

    await page.goto("/sell/private", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /private listing|create listing/i }).first()
    ).toBeVisible({ timeout: 20_000 });

    await page.goto(`/sell/checkout?listing=${listing.id}&flow=private`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: /checkout cancelled/i })
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole("button", { name: /retry checkout/i })
    ).toBeVisible({ timeout: 20_000 });

    await db.listing.update({
      where: { id: listing.id },
      data: { status: "PENDING" },
    });

    await page.goto("/admin/listings", { waitUntil: "domcontentloaded" });
    const row = page.locator("tr", { hasText: listing.title }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByText("PENDING")).toBeVisible({ timeout: 20_000 });
  });

  test("report flow: listing detail report creates moderation report", async ({ page }) => {
    const listing = await createListingForE2E({
      status: "LIVE",
      titleSuffix: "Report Flow",
    });
    const reporterEmail = `e2e-report-${Date.now()}@example.com`;

    await signInAsAdmin(page);

    await page.goto(`/listings/${listing.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: listing.title })).toBeVisible({
      timeout: 20_000,
    });

    await page.getByRole("button", { name: /report this listing/i }).click();
    await page.getByLabel(/your email/i).fill(reporterEmail);
    await page.getByLabel(/reason/i).fill(
      "Suspicious listing details for e2e validation workflow."
    );
    await page.getByRole("button", { name: /submit report/i }).click();

    await expect(page.getByText(/report submitted\. thank you\./i)).toBeVisible({
      timeout: 20_000,
    });

    await expect
      .poll(async () => {
        return db.report.count({
          where: {
            listingId: listing.id,
            reporterEmail,
          },
        });
      })
      .toBe(1);
  });
});
