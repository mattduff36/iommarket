/* @vitest-environment node */

import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { resetRateLimitsForTests } from "@/lib/rate-limit";
import { LAUNCH_GATE_COOKIE, verifyLaunchGateCookie } from "@/lib/launch/session";

const GATE_SECRET = "0123456789abcdef0123456789abcdef";

const ORIGINAL_ENV = {
  DEV_PASS: process.env.DEV_PASS,
  PREVIEW_PASS: process.env.PREVIEW_PASS,
  PREVIEW_URL: process.env.PREVIEW_URL,
  DEV_GATE_SECRET: process.env.DEV_GATE_SECRET,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function buildRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:4000/api/dev-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/dev-auth", () => {
  afterEach(() => {
    restoreEnv();
    resetRateLimitsForTests();
  });

  it("sets a signed host-only gate cookie for DEV_PASS", async () => {
    process.env.DEV_PASS = "dev-secret";
    process.env.PREVIEW_PASS = "preview-secret";
    process.env.PREVIEW_URL = "https://preview.example.com";
    process.env.DEV_GATE_SECRET = GATE_SECRET;

    const { POST } = await import("@/app/api/dev-auth/route");
    const response = await POST(buildRequest({ password: "dev-secret" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${LAUNCH_GATE_COOKIE}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).not.toMatch(/Domain=/i);
    expect(setCookie).not.toContain("dev-auth=true");
    const token = setCookie.split(`${LAUNCH_GATE_COOKIE}=`)[1]?.split(";")[0];
    expect(
      verifyLaunchGateCookie(token, {
        secret: GATE_SECRET,
        environment: "test",
      }),
    ).toBe(true);
  });

  it("returns PREVIEW_URL without a session cookie for PREVIEW_PASS", async () => {
    process.env.DEV_PASS = "dev-secret";
    process.env.PREVIEW_PASS = "preview-secret";
    process.env.PREVIEW_URL = "https://preview.example.com";

    const { POST } = await import("@/app/api/dev-auth/route");
    const response = await POST(buildRequest({ password: "preview-secret" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      redirect: "https://preview.example.com",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects an unknown password with 401", async () => {
    process.env.DEV_PASS = "dev-secret";
    process.env.PREVIEW_PASS = "preview-secret";
    process.env.PREVIEW_URL = "https://preview.example.com";

    const { POST } = await import("@/app/api/dev-auth/route");
    const response = await POST(buildRequest({ password: "wrong-password" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Invalid password" });
  });
});
