import { describe, expect, it } from "vitest";
import { saveChecklistSchema } from "@/lib/validations/admin";
import { createChecklistItem } from "@/lib/admin/checklist";

const NOW = new Date("2026-08-14T21:00:00.000Z");

describe("saveChecklistSchema", () => {
  it("accepts a valid checklist payload", () => {
    const result = saveChecklistSchema.safeParse({
      items: [createChecklistItem({ title: "GDPR advice" }, NOW)],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a blank title", () => {
    const result = saveChecklistSchema.safeParse({
      items: [{ ...createChecklistItem({ title: "Keep" }, NOW), title: "  " }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts an item assigned to both DM and MD", () => {
    const result = saveChecklistSchema.safeParse({
      items: [
        createChecklistItem(
          { title: "Shared task", labels: ["MD", "DM"] },
          NOW,
        ),
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0]?.labels).toEqual(["DM", "MD"]);
    }
  });

  it("rejects more than 200 items", () => {
    const items = Array.from({ length: 201 }, (_, index) =>
      createChecklistItem({ title: `Item ${index}` }, NOW),
    );
    const result = saveChecklistSchema.safeParse({ items });
    expect(result.success).toBe(false);
  });
});
