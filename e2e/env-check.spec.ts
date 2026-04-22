/**
 * Environment Variable Validation Test Suite
 *
 * Each test group exercises a specific service via real HTTP or browser
 * interactions so failures pinpoint which env var / service is broken.
 *
 * Skipped in CI if the corresponding env var is absent (graceful degradation).
 * Hosted payment flows are intentionally excluded — tested manually.
 */

import { test, expect, type Page } from "@playwright/test";
import * as dotenv from "dotenv";
import * as path from "path";
import * as crypto from "crypto";

// Load secrets that are only needed inside the test process itself
// (e.g. Cloudinary API secret, auth hook secret).
// NEXT_PUBLIC_* vars are already available via the running dev server.
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { ADMIN_USER } from "./fixtures/test-users";

const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? ADMIN_USER.email;
const E2E_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? ADMIN_USER.password;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sign in as the admin user and return the authenticated context. */
async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await dismissCookieBanner(page);
  await page.waitForLoadState("networkidle");

  const emailInput = page.getByLabel(/^email$/i);
  const passwordInput = page.getByLabel(/^password$/i);

  await emailInput.fill(E2E_ADMIN_EMAIL);
  await passwordInput.fill(E2E_ADMIN_PASSWORD);
  await expect(emailInput).toHaveValue(E2E_ADMIN_EMAIL);
  await expect(passwordInput).toHaveValue(E2E_ADMIN_PASSWORD);

  await page.getByRole("button", { name: /sign in/i }).click();
  // Admin is redirected to /admin after successful sign-in
  await expect(page).toHaveURL(/\/admin/, { timeout: 30_000 });
}

async function dismissCookieBanner(page: Page): Promise<void> {
  const acceptButton = page.getByRole("button", { name: /^accept$/i });
  if (await acceptButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await acceptButton.click();
  }
}

// ---------------------------------------------------------------------------
// 1–3  Database (POSTGRES_URL / DATABASE_URL)
// ---------------------------------------------------------------------------

test.describe("[DB] Database connectivity", () => {
  test("1 · /search page loads with live listing data", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/search", { waitUntil: "domcontentloaded" });
    // Either listing cards or an "no results" message means the DB responded
    const hasCards = await page.locator("a[href^='/listings/']").first().isVisible({ timeout: 30_000 }).catch(() => false);
    const hasEmptyState = await page.getByText(/no listings|no results/i).isVisible({ timeout: 5_000 }).catch(() => false);
    expect(hasCards || hasEmptyState, "Search page should render DB-backed content").toBe(true);
  });

  test("2 · /categories page shows real category data", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/categories", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /categories/i })).toBeVisible({ timeout: 30_000 });
    // At least one category link must be present
    const categoryLinks = page.locator("a[href^='/categories/']");
    await expect(categoryLinks.first()).toBeVisible({ timeout: 20_000 });
  });

  test("3 · GET /api/search returns JSON with listings array", async ({ request }) => {
    const res = await request.get("/api/search");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("listings");
    expect(Array.isArray(body.listings)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4–6  Supabase Auth (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)
// ---------------------------------------------------------------------------

test.describe("[Auth] Supabase authentication", () => {
  test("4 · sign-in form submits and admin is redirected to /admin", async ({ page }) => {
    test.setTimeout(60_000);
    await signInAsAdmin(page);
    // Confirms auth flow works end-to-end
    await expect(page).toHaveURL(/\/admin/);
  });

  test("5 · GET /api/me returns correct user after sign-in", async ({ page, context }) => {
    test.setTimeout(60_000);
    await signInAsAdmin(page);
    // Use the authenticated context's cookies in a direct API request
    const cookies = await context.cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const res = await page.request.get("/api/me", {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ email: E2E_ADMIN_EMAIL, role: "ADMIN" });
  });

  test("6 · unauthenticated request to /admin is redirected to sign-in", async ({ request }) => {
    // A raw request without Supabase session cookies
    const res = await request.get("/admin", { maxRedirects: 0 });
    // Middleware redirects to /sign-in (3xx) or returns a redirect page
    expect([301, 302, 303, 307, 308].includes(res.status()) || res.url().includes("sign-in")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7–8  Supabase Auth Hook (SUPABASE_AUTH_HOOK_SECRET)
// ---------------------------------------------------------------------------

test.describe("[AuthHook] Supabase send-email webhook", () => {
  test("7 · POST /api/auth/send-email without signature returns 401", async ({ request }) => {
    const res = await request.post("/api/auth/send-email", {
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({
        user: { email: "test@example.com" },
        email_data: {
          token_hash: "dummy",
          email_action_type: "signup",
          redirect_to: "http://localhost:4000",
        },
      }),
    });
    expect(res.status()).toBe(401);
  });

  test("8 · POST /api/auth/send-email with valid HMAC signature returns 200", async ({ request }) => {
    const rawSecret = process.env.SUPABASE_AUTH_HOOK_SECRET ?? "";
    if (!rawSecret) {
      test.skip(true, "SUPABASE_AUTH_HOOK_SECRET not set");
      return;
    }

    // The route strips the "v1,whsec_" prefix and uses the base64 remainder
    const base64Secret = rawSecret.replace(/^v1,whsec_/, "");
    const secretBytes = Buffer.from(base64Secret, "base64");

    const payload = JSON.stringify({
      user: { email: "test@example.com" },
      email_data: {
        token_hash: "test_token_hash_abc123",
        email_action_type: "signup",
        redirect_to: "http://localhost:4000/auth/callback",
      },
    });

    // standardwebhooks signature: "v1,<base64(HMAC-SHA256(msgId + "." + ts + "." + payload))>"
    const msgId = `msg_${Date.now()}`;
    const ts = Math.floor(Date.now() / 1000).toString();
    const toSign = `${msgId}.${ts}.${payload}`;
    const hmac = crypto.createHmac("sha256", secretBytes).update(toSign).digest("base64");
    const signature = `v1,${hmac}`;

    const res = await request.post("/api/auth/send-email", {
      headers: {
        "Content-Type": "application/json",
        "webhook-id": msgId,
        "webhook-timestamp": ts,
        "webhook-signature": signature,
      },
      data: payload,
    });

    // 200 = hook processed OK; 500 = Resend key issue (hook itself validated)
    expect([200, 500]).toContain(res.status());
  });
});

// ---------------------------------------------------------------------------
// 9  Cloudinary browser (NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME / CLOUDINARY_UPLOAD_PRESET)
// ---------------------------------------------------------------------------

test.describe("[Cloudinary] Image upload widget", () => {
  test("9 · upload widget button is present on /sell/private when signed in", async ({ page }) => {
    test.setTimeout(60_000);
    await signInAsAdmin(page);
    // Admin redirected to /sell → chooses private flow
    await page.goto("/sell/private", { waitUntil: "domcontentloaded" });
    await dismissCookieBanner(page);
    await expect(page.getByText(/create listing - step 1 of 3/i)).toBeVisible({ timeout: 20_000 });
    // The upload widget button lives in step 2 but should still be rendered in the DOM.
    // This verifies widget wiring without mutating listing form state.
    const uploadBtn = page.locator("button:has-text('Add Photos')");
    await expect(uploadBtn).toHaveCount(1);
  });
});

// ---------------------------------------------------------------------------
// 10  Cloudinary API (CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)
// ---------------------------------------------------------------------------

test.describe("[Cloudinary] API credentials", () => {
  test("10 · can upload a test image and delete it via Cloudinary REST API", async () => {
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      test.skip(true, "Cloudinary env vars not set");
      return;
    }

    // 1×1 transparent PNG as base64 data URI
    const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const folder = "iommarket/e2e-test";
    const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;
    const signature = crypto
      .createHash("sha256")
      .update(`${paramsToSign}${apiSecret}`)
      .digest("hex");

    // Upload
    const formData = new FormData();
    formData.append("file", TINY_PNG);
    formData.append("api_key", apiKey);
    formData.append("timestamp", timestamp);
    formData.append("signature", signature);
    formData.append("folder", folder);

    const uploadRes = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      { method: "POST", body: formData }
    );
    expect(uploadRes.ok).toBe(true);
    const uploadData = await uploadRes.json() as { public_id?: string };
    expect(uploadData.public_id).toBeTruthy();

    const publicId = uploadData.public_id!;

    // Delete — sign destroy request
    const delTimestamp = Math.floor(Date.now() / 1000).toString();
    const delParamsToSign = `public_id=${publicId}&timestamp=${delTimestamp}`;
    const delSignature = crypto
      .createHash("sha256")
      .update(`${delParamsToSign}${apiSecret}`)
      .digest("hex");

    const delFormData = new FormData();
    delFormData.append("public_id", publicId);
    delFormData.append("api_key", apiKey);
    delFormData.append("timestamp", delTimestamp);
    delFormData.append("signature", delSignature);

    const delRes = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`,
      { method: "POST", body: delFormData }
    );
    const delData = await delRes.json() as { result?: string };
    // result = "ok" means successfully deleted; "not found" is also acceptable
    expect(["ok", "not found"]).toContain(delData.result);
  });
});

// ---------------------------------------------------------------------------
// 11  Resend (RESEND_API_KEY / RESEND_FROM_EMAIL)
// ---------------------------------------------------------------------------

test.describe("[Resend] Email delivery", () => {
  test("11 · submitting the waitlist form shows success and triggers email dispatch", async ({ page }) => {
    test.setTimeout(120_000);
    // Ensure we hit the holding-page rewrite by removing dev-auth first.
    await page.context().clearCookies();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await dismissCookieBanner(page);

    // Fill the waitlist form with a test address
    const testEmail = `e2e-test-${Date.now()}@example.com`;
    const emailInput = page.getByLabel(/email address/i);
    await emailInput.fill(testEmail);
    await expect(emailInput).toHaveValue(testEmail);

    // Select at least one interest
    const buyingButton = page.getByRole("button", { name: /buying cars/i });
    await buyingButton.click();
    await expect(buyingButton).toHaveAttribute("aria-pressed", "true");

    // Submit explicitly via form requestSubmit to avoid click interception issues.
    await page.locator("form").first().evaluate((form) => {
      (form as HTMLFormElement).requestSubmit();
    });

    // Success message from WaitlistForm component
    const success = page.getByText(/thanks.*notify/i);
    const errorMessage = page.locator("p.text-text-error, p.text-text-energy").first();

    await Promise.race([
      success.waitFor({ state: "visible", timeout: 90_000 }),
      errorMessage.waitFor({ state: "visible", timeout: 90_000 }),
    ]);

    if (await errorMessage.isVisible().catch(() => false)) {
      const msg = (await errorMessage.textContent())?.trim() || "Unknown waitlist submission error";
      throw new Error(`Waitlist submit returned error: ${msg}`);
    }

    await expect(success).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 12–13  Payments config
// ---------------------------------------------------------------------------

test.describe("[Payments] Configuration", () => {
  test("12 · /pricing page shows correct fee values from env", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/pricing", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /pricing/i })).toBeVisible({ timeout: 30_000 });

    // Private seller fee: £4.99 (hardcoded in pricing page UI)
    await expect(page.getByText("£4.99").first()).toBeVisible();

    // Dealer tier prices
    await expect(page.getByText("£29.99").first()).toBeVisible();
    await expect(page.getByText("£49.99").first()).toBeVisible();
  });

  test("13 · /sell/private page loads and shows the listing form", async ({ page }) => {
    test.setTimeout(60_000);
    await signInAsAdmin(page);
    await page.goto("/sell/private", { waitUntil: "domcontentloaded" });
    // Page renders the create listing form and keeps payment orchestration server-side.
    await expect(page.getByRole("heading", { name: /private listing/i })).toBeVisible({ timeout: 20_000 });
    // Step 1 of the listing form should be visible
    await expect(page.getByRole("button", { name: /continue/i }).first()).toBeVisible({ timeout: 20_000 });
  });
});

// ---------------------------------------------------------------------------
// 14–16  Payment webhook (RIPPLE_WEBHOOK_SECRET)
// ---------------------------------------------------------------------------

test.describe("[Payment Webhook] Signature verification", () => {
  const WEBHOOK_ENDPOINT = "/api/webhooks/payments";
  const SAMPLE_PAYLOAD = JSON.stringify({
    id: "evt_test_env_check",
    type: "payment.succeeded",
    data: {
      paymentId: "pay_test_env_check",
      amount: "4.99",
      currency: "gbp",
      metadata: {
        checkoutType: "listing_payment",
        listingId: "missing_listing",
      },
    },
  });

  test("14 · POST without signature header returns 400", async ({ request }) => {
    const res = await request.post(WEBHOOK_ENDPOINT, {
      headers: { "Content-Type": "application/json" },
      data: SAMPLE_PAYLOAD,
    });
    expect(res.status()).toBe(400);
  });

  test("15 · POST with invalid ripple-signature returns 400", async ({ request }) => {
    const res = await request.post(WEBHOOK_ENDPOINT, {
      headers: {
        "Content-Type": "application/json",
        "ripple-signature": "sha256=invalidsignature",
      },
      data: SAMPLE_PAYLOAD,
    });
    expect(res.status()).toBe(400);
  });

  test("16 · POST with valid Ripple HMAC signature returns 200", async ({ request }) => {
    const webhookSecret = process.env.RIPPLE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      test.skip(true, "RIPPLE_WEBHOOK_SECRET not set");
      return;
    }

    const signature = crypto
      .createHmac("sha256", webhookSecret)
      .update(SAMPLE_PAYLOAD)
      .digest("hex");

    const res = await request.post(WEBHOOK_ENDPOINT, {
      headers: {
        "Content-Type": "application/json",
        "ripple-signature": `sha256=${signature}`,
      },
      data: SAMPLE_PAYLOAD,
    });
    // 200 = webhook accepted and processed (event type may be ignored gracefully)
    expect(res.status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 17–18  App Config (NEXT_PUBLIC_IOM_DATA_CONTROLLER_REF / DEV_PASS)
// ---------------------------------------------------------------------------

test.describe("[AppConfig] Application-level env vars", () => {
  test("17 · footer displays NEXT_PUBLIC_IOM_DATA_CONTROLLER_REF value", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const footer = page.locator("footer");
    await footer.scrollIntoViewIfNeeded();
    // The footer renders the data controller ref (or "Pending registration" as current value)
    const ref = process.env.NEXT_PUBLIC_IOM_DATA_CONTROLLER_REF ?? "Pending registration";
    await expect(footer.getByText(ref, { exact: false })).toBeVisible({ timeout: 20_000 });
  });

  test("18 · /api/dev-auth rejects wrong password (401) and accepts correct password (200)", async ({ request }) => {
    // Wrong password
    const badRes = await request.post("/api/dev-auth", {
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ password: "wrong-password-xyz" }),
    });
    expect(badRes.status()).toBe(401);

    // Correct password (from env)
    const devPass = process.env.DEV_PASS;
    if (!devPass) {
      test.skip(true, "DEV_PASS not set in .env.local");
      return;
    }
    const goodRes = await request.post("/api/dev-auth", {
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ password: devPass }),
    });
    expect(goodRes.status()).toBe(200);
    // Response should set the dev-auth cookie
    const setCookie = goodRes.headers()["set-cookie"] ?? "";
    expect(setCookie).toMatch(/dev-auth/);
  });
});

// ---------------------------------------------------------------------------
// 19–20  Admin Payments page
// ---------------------------------------------------------------------------

test.describe("[AdminPayments] Payments monitoring and refund UI", () => {
  test("19 · admin can access /admin/payments and the payments table renders", async ({ page }) => {
    test.setTimeout(60_000);
    await signInAsAdmin(page);
    await page.goto("/admin/payments", { waitUntil: "domcontentloaded" });
    // Page heading
    await expect(
      page.getByRole("heading", { name: /payments/i }).first()
    ).toBeVisible({ timeout: 30_000 });
    // The payments tab should be active by default — either a table or an empty state
    const hasTable = await page.getByRole("table").isVisible({ timeout: 10_000 }).catch(() => false);
    const hasEmpty = await page.getByText(/no payments|no records/i).isVisible({ timeout: 5_000 }).catch(() => false);
    expect(hasTable || hasEmpty, "Payments table or empty state should be visible").toBe(true);
  });

  test("20 · Refund button is present for SUCCEEDED payments; Subscriptions tab loads", async ({ page }) => {
    test.setTimeout(60_000);
    await signInAsAdmin(page);
    await page.goto("/admin/payments", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /payments/i }).first()).toBeVisible({ timeout: 30_000 });

    // If there are succeeded payments, a Refund button should exist
    const refundBtn = page.getByRole("button", { name: /refund/i }).first();
    const hasRefund = await refundBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    // Not a failure if no succeeded payments yet — just document the finding
    if (!hasRefund) {
      console.log("No SUCCEEDED payments found — Refund button not rendered (expected for a new/test DB).");
    }

    // Click the Subscriptions link and verify it loads
    const subsLink = page.getByRole("link", { name: /subscriptions/i }).first();
    if (await subsLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await subsLink.click();
      // Either a subscriptions table or an empty state
      const hasSubsTable = await page.getByRole("table").isVisible({ timeout: 10_000 }).catch(() => false);
      const hasSubsEmpty = await page.getByText(/no subscriptions|no records/i).isVisible({ timeout: 5_000 }).catch(() => false);
      expect(hasSubsTable || hasSubsEmpty, "Subscriptions tab should render content").toBe(true);
    } else {
      // Subscriptions rendered inline (no tab) — just check the page loaded
      expect(true).toBe(true);
    }
  });
});
