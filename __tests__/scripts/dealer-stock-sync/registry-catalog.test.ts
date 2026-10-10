import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEALER_STOCK_REGISTRY_OPTIONS } from "@/lib/dealer-stock-sync/registry-catalog";
import { DEALER_REGISTRY } from "../../../scripts/dealer-stock-sync/registry";

describe("dealer stock registry catalog", () => {
  it("matches confirmed public registry entries and stays out of the web bundle", () => {
    const expected = DEALER_REGISTRY.filter((dealer) => dealer.status === "confirmed" && dealer.website).map(
      (dealer) => dealer.key,
    );
    expect(DEALER_STOCK_REGISTRY_OPTIONS.map((option) => option.key)).toEqual(expected);
    const bundled = [
      "actions/admin/dealer-stock-sync.ts",
      "app/api/cron/dealer-stock-sync/route.ts",
      "lib/dealer-stock-sync/enqueue.ts",
      "app/(admin)/admin/dealers/[dealerId]/stock-sync/page.tsx",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(bundled).not.toMatch(/scripts\/dealer-stock-sync\/(browse|pipeline|website-source)/);
    expect(bundled).not.toMatch(/playwright/);
  });
});
