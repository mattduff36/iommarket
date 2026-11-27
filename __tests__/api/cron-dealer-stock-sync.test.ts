import { existsSync } from "node:fs";
import { expect, it } from "vitest";
import config from "../../vercel.json";

it("keeps dealer scrapes manual", () => {
  expect(config.crons.some(cron => cron.path === "/api/cron/dealer-stock-sync")).toBe(false);
  expect(existsSync("app/api/cron/dealer-stock-sync/route.ts")).toBe(false);
});
