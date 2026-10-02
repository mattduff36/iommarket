import { expect, test, type Page } from "@playwright/test";
import { db } from "../lib/db";
import {
  cleanupDisposableAccountFixtures,
  createDisposableAccount,
  seedDisposableListing,
  seedDisposableSavedSearch,
} from "./fixtures/disposable-accounts";

test.describe.configure({ timeout: 150_000 });

test.beforeEach(({ }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Account action smoke runs on desktop Chromium.");
});

test.afterEach(async () => {
  await cleanupDisposableAccountFixtures();
});

async function waitForHydratedControl(page: Page, label: string) {
  await page.waitForFunction((ariaLabel) => {
    const control = [...document.querySelectorAll("button")].find(
      (node) => node.getAttribute("aria-label") === ariaLabel,
    );
    return Boolean(control && Object.keys(control).some((key) => key.startsWith("__react")));
  }, label);
}

async function dismissCookieBanner(page: Page) {
  const acceptButton = page.getByRole("button", { name: /accept all|^accept$/i });
  if (await acceptButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await acceptButton.click();
  }
}

async function signIn(page: Page, email: string, password: string, nextPath: string) {
  const browserNotes: string[] = [];
  page.on("console", (message) => browserNotes.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => browserNotes.push(error.message));
  await page.goto(`/sign-in?next=${encodeURIComponent(nextPath)}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    return Boolean(form && Object.keys(form).some((key) => key.startsWith("__react")));
  });
  await dismissCookieBanner(page);
  const emailField = page.getByRole("textbox", { name: "Email" });
  const passwordField = page.getByRole("textbox", { name: "Password" });
  await emailField.fill(email);
  await passwordField.fill(password);
  await expect(emailField).toHaveValue(email);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  try {
    await expect(page).toHaveURL(new RegExp(`${nextPath.replaceAll("/", "\\/")}$`), {
      timeout: 30_000,
    });
  } catch (error) {
    const formText = await page.locator("main").innerText().catch(() => "");
    const reason = error instanceof Error ? error.message : "Sign-in did not leave the sign-in page.";
    throw new Error(`${reason}\n\nForm:\n${formText}\n\nBrowser:\n${browserNotes.join("\n")}`);
  }
}

async function confirmTwice(
  page: Page,
  dialogName: string,
  confirmName: string,
  pendingName: string,
) {
  await page.evaluate((pending) => {
    const view = document.defaultView;
    if (!view) return;
    Reflect.set(view, "__accountActionPending", false);
    const observer = new MutationObserver(() => {
      if (document.body.innerText.includes(pending)) {
        Reflect.set(view, "__accountActionPending", true);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }, pendingName);
  const dialog = page.getByRole("dialog", { name: dialogName });
  await dialog.getByRole("button", { name: confirmName, exact: true }).evaluate((button) => {
    if (!(button instanceof HTMLElement)) return;
    button.click();
    button.click();
  });
  await expect.poll(
    () => page.evaluate(() => Reflect.get(window, "__accountActionPending") === true),
    { timeout: 15_000 },
  ).toBe(true);
}

test("member mark-sold and saved-search delete confirm, cancel, and submit once @account-actions", async ({
  page,
}) => {
  const member = await createDisposableAccount("member");
  const listing = await seedDisposableListing({
    userId: member.userId,
    status: "LIVE",
    title: `E2E member sold ${member.userId}`,
  });
  const saved = await seedDisposableSavedSearch({
    userId: member.userId,
    name: `E2E saved ${member.userId}`,
  });

  await signIn(page, member.email, member.password, "/account/listings");
  await page.getByRole("button", { name: `Actions for ${listing.title}` }).click();
  await page.getByRole("menuitem", { name: "Mark as sold" }).click();
  const soldDialog = page.getByRole("dialog", { name: "Mark as sold" });
  await expect(soldDialog).toBeVisible();
  await soldDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(soldDialog).toBeHidden();
  expect(await db.listing.findUnique({ where: { id: listing.id }, select: { status: true } })).toEqual({
    status: "LIVE",
  });
  expect(await db.listingStatusEvent.count({ where: { listingId: listing.id, action: "MARK_SOLD" } })).toBe(0);

  await page.getByRole("button", { name: `Actions for ${listing.title}` }).click();
  await page.getByRole("menuitem", { name: "Mark as sold" }).click();
  await confirmTwice(page, "Mark as sold", "Mark as sold", "Marking sold…");
  await expect(page.getByText("Marked as sold.")).toBeVisible({ timeout: 60_000 });
  expect(await db.listing.findUnique({ where: { id: listing.id }, select: { status: true } })).toEqual({
    status: "SOLD",
  });
  expect(await db.listingStatusEvent.count({ where: { listingId: listing.id, action: "MARK_SOLD" } })).toBe(1);
  await expect(page.getByRole("table").getByText("SOLD", { exact: true })).toBeVisible();

  await page.goto("/account/saved-searches", { waitUntil: "domcontentloaded" });
  const savedActions = page.getByRole("button", { name: `Actions for ${saved.name}` });
  await waitForHydratedControl(page, `Actions for ${saved.name}`);
  await savedActions.click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete saved search" });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(deleteDialog).toBeHidden();
  expect(await db.savedSearch.count({ where: { id: saved.id } })).toBe(1);

  await savedActions.click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await confirmTwice(page, "Delete saved search", "Delete saved search", "Removing…");
  await expect(page.getByText("No saved searches yet.")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  expect(await db.savedSearch.count({ where: { id: saved.id } })).toBe(0);
});

test("dealer withdraw returns a pending listing to draft once @account-actions", async ({ page }) => {
  const dealer = await createDisposableAccount("dealer");
  const listing = await seedDisposableListing({
    userId: dealer.userId,
    dealerId: dealer.dealerId,
    status: "PENDING",
    title: `E2E dealer withdraw ${dealer.userId}`,
  });

  await signIn(page, dealer.email, dealer.password, "/dealer/dashboard");
  await page.getByRole("button", { name: `Actions for ${listing.title}` }).click();
  await page.getByRole("menuitem", { name: "Withdraw submission" }).click();
  const dialog = page.getByRole("dialog", { name: "Withdraw submission" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(await db.listing.findUnique({ where: { id: listing.id }, select: { status: true } })).toEqual({
    status: "PENDING",
  });
  expect(await db.listingStatusEvent.count({ where: { listingId: listing.id, action: "WITHDRAW" } })).toBe(0);

  await page.getByRole("button", { name: `Actions for ${listing.title}` }).click();
  await page.getByRole("menuitem", { name: "Withdraw submission" }).click();
  await confirmTwice(page, "Withdraw submission", "Withdraw submission", "Withdrawing…");
  await expect(page).toHaveURL(new RegExp(`/sell/dealer\\?draft=${listing.id}`), { timeout: 30_000 });
  expect(await db.listing.findUnique({ where: { id: listing.id }, select: { status: true } })).toEqual({
    status: "DRAFT",
  });
  expect(await db.listingStatusEvent.count({ where: { listingId: listing.id, action: "WITHDRAW" } })).toBe(1);
});
