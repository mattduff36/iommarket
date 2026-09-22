import { test as setup } from "@playwright/test";
import path from "path";
import { issueLaunchGateCookie, LAUNCH_GATE_COOKIE } from "../lib/launch/session";

const STORAGE_STATE = path.join(__dirname, ".auth/storage-state.json");

setup("set launch gate cookie", async ({ context }) => {
  const issued = issueLaunchGateCookie({
    secret: process.env.DEV_GATE_SECRET,
    environment: "development",
  });
  if (!issued) {
    throw new Error("DEV_GATE_SECRET must be at least 32 bytes for Playwright.");
  }

  const hostname = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:4000").hostname;
  await context.addCookies([
    {
      name: LAUNCH_GATE_COOKIE,
      value: issued.value,
      domain: hostname,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);

  await context.storageState({ path: STORAGE_STATE });
});
