import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Stock Update source encoding", () => {
  it("keeps UI source readable by the deployed UTF-8 bundler and native compiler", () => {
    for (const file of [
      "app/(admin)/admin/stock-reviews/page.tsx",
      "app/(admin)/admin/stock-reviews/dealer-picker.tsx",
      "app/(admin)/admin/stock-reviews/worker-dashboard.tsx",
      "app/(admin)/admin/stock-reviews/worker-pairing.tsx",
      "desktop/StockUpdate/MainForm.cs",
    ]) {
      expect(() => new TextDecoder("utf-8", {fatal:true}).decode(readFileSync(resolve(file)))).not.toThrow();
    }
  });
});
