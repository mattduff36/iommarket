import { expect, test, type Page } from "@playwright/test";
import { db } from "../lib/db";
import { ADMIN_USER } from "./fixtures/test-users";
import {
  cleanupAdminProfileEditFixtures,
  createAdminProfileEditFixture,
  type AdminProfileEditFixture,
} from "./fixtures/admin-profile-edit";

const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? ADMIN_USER.email;
const E2E_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? ADMIN_USER.password;

async function dismissCookieBanner(page: Page): Promise<void> {
  const acceptButton = page.getByRole("button", { name: /accept all|^accept$/i });
  if (await acceptButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await acceptButton.click();
  }
}

async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await dismissCookieBanner(page);
  await page.waitForLoadState("networkidle");
  await page.getByLabel(/^email/i).fill(E2E_ADMIN_EMAIL);
  await page.getByLabel(/^password/i).fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 30_000 });
}

test.describe("admin profile editing", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Admin profile editing runs once in the desktop project.");
  });

  test.afterEach(async () => {
    await cleanupAdminProfileEditFixtures();
  });

  test("renames a disposable dealer from the admin user page and keeps its identity", async ({ page }) => {
    test.setTimeout(180_000);
    const fixture = await createAdminProfileEditFixture();
    await signInAsAdmin(page);

    await page.goto(`/admin/users/${fixture.userId}`);
    await page.getByRole("link", { name: "Edit profile" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/users/${fixture.userId}/profile$`), {
      timeout: 30_000,
    });
    await expect(page.getByText(fixture.email)).toBeVisible();

    await page.getByLabel("Business name").fill("Ocean Motor Village");
    await saveProfile(page);

    await page.getByLabel("Dealer phone").fill("01624 999999");
    await saveProfile(page);

    await page.reload();
    await expect(page.getByLabel("Business name")).toHaveValue("Ocean Motor Village");
    await expect(page.getByLabel("Dealer phone")).toHaveValue("01624 999999");
    await expect(page.getByLabel("Account name")).toHaveValue(fixture.accountName);
    await expect(page.getByText(`/dealers/${fixture.slug}`).first()).toBeVisible();

    await page.goto(`/admin/users/${fixture.userId}`);
    await expect(page.getByRole("heading", { name: fixture.accountName })).toBeVisible();
    await expect(page.getByText("Ocean Motor Village").first()).toBeVisible();

    await page.goto(`/dealers/${fixture.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: "Ocean Motor Village" })).toBeVisible();

    await page.goto(`/listings/${fixture.listingId}`);
    await expect(page.getByText("Ocean Motor Village").first()).toBeVisible();

    await page.goto(`/admin/dealers?q=${encodeURIComponent(fixture.slug)}`);
    await page.getByRole("button", { name: "Actions for Ocean Motor Village" }).click();
    await page.getByRole("menuitem", { name: "Edit dealer profile" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/users/${fixture.userId}/profile$`), {
      timeout: 30_000,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/users/${fixture.userId}/profile`);
    await expect(page.getByRole("button", { name: "Save profile" })).toBeVisible();
    await expect(page.getByLabel("Business name")).toBeVisible();

    await expectPreservedFixture(fixture);
  });
});

async function saveProfile(page: Page) {
  const saveButton = page.getByRole("button", { name: "Save profile" });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(saveButton).toBeDisabled();
  await expect(page.getByText("Profile saved.")).toBeVisible();
}

async function expectPreservedFixture(fixture: AdminProfileEditFixture) {
  const [user, dealer, listing, subscription, audit] = await Promise.all([
    db.user.findUnique({ where: { id: fixture.userId } }),
    db.dealerProfile.findUnique({ where: { id: fixture.dealerId } }),
    db.listing.findUnique({ where: { id: fixture.listingId } }),
    db.subscription.findUnique({ where: { id: fixture.subscriptionId } }),
    db.adminAuditLog.findFirst({
      where: {
        action: "UPDATE_DEALER_PROFILE",
        entityId: fixture.dealerId,
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  expect(user?.id).toBe(fixture.userId);
  expect(user?.name).toBe(fixture.accountName);
  expect(user?.email).toBe(fixture.email);
  expect(dealer?.id).toBe(fixture.dealerId);
  expect(dealer?.userId).toBe(fixture.userId);
  expect(dealer?.name).toBe("Ocean Motor Village");
  expect(dealer?.slug).toBe(fixture.slug);
  expect(dealer?.phone).toBe("01624 999999");
  expect(dealer?.isAdminPreview).toBe(false);
  expect(listing?.userId).toBe(fixture.userId);
  expect(listing?.dealerId).toBe(fixture.dealerId);
  expect(subscription?.status).toBe("ACTIVE");
  expect(subscription?.source).toBe("ADMIN_GRANT");
  expect(audit?.details).toMatchObject({
    fields: ["name"],
    before: { name: fixture.initialDealerName },
    after: { name: "Ocean Motor Village" },
  });
}
