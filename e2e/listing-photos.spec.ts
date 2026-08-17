import { test, expect, type Page } from "@playwright/test";
import { db } from "../lib/db";
import { ADMIN_USER } from "./fixtures/test-users";

const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? ADMIN_USER.email;
const E2E_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? ADMIN_USER.password;

const createdListingIds: string[] = [];

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

async function createDraftWithPhotos() {
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
      title: `E2E Adaptive Photos ${Date.now()}`,
      description:
        "E2E listing used to validate adaptive listing photo order, focus, and draft reload.",
      price: 1_234_00,
      status: "DRAFT",
      trustDeclarationAccepted: true,
      trustDeclarationAcceptedAt: new Date(),
    },
    select: { id: true, title: true },
  });
  createdListingIds.push(listing.id);

  const requiredAttributes = await db.attributeDefinition.findMany({
    where: { categoryId: category.id, required: true },
    select: { id: true, slug: true },
  });
  if (requiredAttributes.length > 0) {
    await db.listingAttributeValue.createMany({
      data: requiredAttributes.map((attribute) => ({
        listingId: listing.id,
        attributeDefinitionId: attribute.id,
        value:
          attribute.slug === "year"
            ? "2019"
            : attribute.slug === "mileage"
              ? "12000"
              : "E2E",
      })),
    });
  }

  await db.listingImage.createMany({
    data: [
      {
        listingId: listing.id,
        url: "https://images.unsplash.com/photo-e2e-one",
        publicId: `demo/${listing.id}-one`,
        order: 0,
        provider: "EXTERNAL",
        width: 1600,
        height: 1000,
        format: "jpg",
      },
      {
        listingId: listing.id,
        url: "https://images.unsplash.com/photo-e2e-two",
        publicId: `demo/${listing.id}-two`,
        order: 1,
        provider: "EXTERNAL",
        width: 900,
        height: 1600,
        format: "jpg",
      },
    ],
  });

  return listing;
}

test.afterEach(async () => {
  if (createdListingIds.length === 0) return;
  await db.listing.deleteMany({
    where: { id: { in: createdListingIds } },
  });
  createdListingIds.length = 0;
});

test.describe("PHOTO-E2E-001 adaptive listing photos", () => {
  test("does not show the old crop dialog on the sell form", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/sell/private", { waitUntil: "domcontentloaded" });
    await dismissCookieBanner(page);
    await expect(page.getByText(/create listing - step 1 of 3/i)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: "Add Photos" })).toHaveCount(1);
    await expect(page.getByText("Crop photo to 16:10")).toHaveCount(0);
  });
});

test.describe("PHOTO-ORDER-E2E-001 listing photo order", () => {
  test("cover and focal changes survive draft reload", async ({ page }) => {
    const listing = await createDraftWithPhotos();
    await signInAsAdmin(page);
    await page.goto(`/sell/private?draft=${listing.id}`, { waitUntil: "domcontentloaded" });
    await dismissCookieBanner(page);

    await expect(page.getByText(/continue editing - step 1 of 3/i)).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByTestId("listing-photo-grid")).toBeVisible();
    await expect(page.getByText("Cover photo")).toBeVisible();

    await page.getByRole("button", { name: "More actions for photo 2" }).click();
    await page.getByRole("menuitem", { name: "Make cover photo" }).click();
    await expect(page.getByText(/is now the cover photo/i)).toBeVisible();

    await page.getByRole("button", { name: "More actions for photo 1" }).click();
    await page.getByRole("menuitem", { name: "Adjust focus" }).click();
    const focusPicker = page.getByRole("button", { name: "Choose photo focus point" });
    await focusPicker.press("Home");
    await focusPicker.press("ArrowRight");
    await page.getByRole("button", { name: "Save focus" }).click();
    await expect(page.getByText("Focus set")).toBeVisible();

    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: /continue to checkout/i }).click();

    await expect
      .poll(async () => {
        const images = await db.listingImage.findMany({
          where: { listingId: listing.id },
          orderBy: { order: "asc" },
          select: { publicId: true, order: true, focalX: true, focalY: true },
        });
        return images;
      }, { timeout: 20_000 })
      .toEqual([
        {
          publicId: `demo/${listing.id}-two`,
          order: 0,
          focalX: 0.51,
          focalY: 0.5,
        },
        {
          publicId: `demo/${listing.id}-one`,
          order: 1,
          focalX: null,
          focalY: null,
        },
      ]);

    const draft = await db.listing.findUnique({
      where: { id: listing.id },
      select: { status: true },
    });
    if (draft?.status !== "DRAFT") {
      return;
    }

    await page.goto(`/sell/private?draft=${listing.id}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByTestId("listing-photo-0")).toBeVisible();
    await expect(page.getByAltText("Upload 1")).toHaveAttribute(
      "src",
      "https://images.unsplash.com/photo-e2e-two",
    );
    await expect(page.getByText("Focus set")).toBeVisible();
  });
});

test.describe("PHOTO-GALLERY-E2E-001 listing photo swipe", () => {
  test("dragging the hero advances the visible position", async ({ page }) => {
    const listing = await createDraftWithPhotos();
    await signInAsAdmin(page);
    await page.goto(`/listings/${listing.id}`, { waitUntil: "domcontentloaded" });
    await dismissCookieBanner(page);

    const stage = page.getByTestId("listing-gallery-stage");
    await expect(stage).toBeVisible();
    await expect(page.getByText("1 / 2")).toBeVisible();
    const box = await stage.boundingBox();
    if (!box) throw new Error("Listing gallery stage is not measurable");

    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 12 });
    await page.mouse.up();

    await expect(page.getByText("2 / 2")).toBeVisible();
  });
});
