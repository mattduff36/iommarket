import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: process.env.CI ? 1 : 3,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "setup",
      testMatch: /global-setup\.ts/,
    },
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/storage-state.json",
      },
      dependencies: ["setup"],
    },
    {
      name: "tablet",
      use: {
        ...devices["iPad (gen 7)"],
        storageState: "e2e/.auth/storage-state.json",
      },
      dependencies: ["setup"],
    },
    {
      name: "mobile",
      use: {
        ...devices["iPhone 13"],
        storageState: "e2e/.auth/storage-state.json",
      },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
