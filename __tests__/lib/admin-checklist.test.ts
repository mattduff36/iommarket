import { describe, expect, it } from "vitest";
import {
  createChecklistItem,
  createDefaultChecklistItems,
  normalizeChecklistLabels,
  remainingChecklistCount,
  sortChecklistItems,
} from "@/lib/admin/checklist";

const NOW = new Date("2026-08-14T21:00:00.000Z");

describe("createDefaultChecklistItems", () => {
  it("seeds the launch work items in a stable order", () => {
    const items = createDefaultChecklistItems(NOW);

    expect(items.map((item) => item.title)).toEqual([
      "GDPR advice",
      "As a dealer, how do you pause or cancel your subscription?",
      "Website T&Cs — avoid being an agent",
      "Plate checker terms & conditions",
      "Become a founding dealership and receive 3 months free Pro listings",
      "Reduce listing page with dropdowns — see Autotrader",
      "Auction (commission), scrap / parts",
    ]);
    expect(items.every((item) => item.done === false)).toBe(true);
    expect(items.filter((item) => item.labels.includes("DM"))).toHaveLength(3);
    expect(items.some((item) => item.labels.includes("MD"))).toBe(true);
    expect(items.some((item) => item.labels.includes("Future"))).toBe(true);
  });
});

describe("normalizeChecklistLabels", () => {
  it("keeps DM and MD together in a stable order", () => {
    expect(normalizeChecklistLabels(["MD", "DM", "DM"])).toEqual(["DM", "MD"]);
  });
});

describe("sortChecklistItems", () => {
  it("keeps open items first, then completed, preserving created order", () => {
    const openLater = createChecklistItem(
      { id: "open-later", title: "Open later" },
      new Date("2026-08-14T21:00:02.000Z"),
    );
    const openFirst = createChecklistItem(
      { id: "open-first", title: "Open first" },
      new Date("2026-08-14T21:00:01.000Z"),
    );
    const done = createChecklistItem(
      { id: "done", title: "Done", done: true },
      new Date("2026-08-14T21:00:00.000Z"),
    );

    expect(sortChecklistItems([done, openLater, openFirst]).map((item) => item.id)).toEqual([
      "open-first",
      "open-later",
      "done",
    ]);
  });
});

describe("remainingChecklistCount", () => {
  it("counts only open items", () => {
    const items = [
      createChecklistItem({ title: "Open" }, NOW),
      createChecklistItem({ title: "Done", done: true }, NOW),
    ];
    expect(remainingChecklistCount(items)).toBe(1);
  });
});
