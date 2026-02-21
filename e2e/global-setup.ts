import { test as setup } from "@playwright/test";
import path from "path";

const STORAGE_STATE = path.join(__dirname, ".auth/storage-state.json");

setup("set dev-auth cookie", async ({ context }) => {
  await context.addCookies([
    {
      name: "dev-auth",
      value: "true",
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  await context.storageState({ path: STORAGE_STATE });
});
