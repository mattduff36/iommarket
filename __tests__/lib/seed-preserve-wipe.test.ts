import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  comparePreservedIdentities,
  isPlaceholderAuthUserId,
  isPreservedAuthUserId,
} from "../../prisma/seed/preserve";
import { assertWipePlanBoundaries, getWipePlan } from "../../prisma/seed/wipe";

describe("SEED-PRESERVE-001", () => {
  it("treats placeholder auth IDs as wipeable and real UUIDs as preserved", () => {
    expect(isPlaceholderAuthUserId("00000000-0000-0000-0000-000000000101")).toBe(
      true,
    );
    expect(isPreservedAuthUserId("00000000-0000-0000-0000-000000000101")).toBe(
      false,
    );
    expect(isPreservedAuthUserId("8f3c1d2a-4b5e-6789-abcd-ef0123456789")).toBe(
      true,
    );
  });

  it("compares preserved identity fields before commit", () => {
    const snapshot = [
      {
        id: "user-1",
        authUserId: "auth-1",
        email: "admin@example.com",
        role: "ADMIN",
      },
    ];
    expect(() =>
      comparePreservedIdentities(snapshot, [
        { ...snapshot[0], email: "changed@example.com" },
      ]),
    ).toThrow("Preserved identity changed");
    expect(() => comparePreservedIdentities(snapshot, snapshot)).not.toThrow();
  });

  it("does not overwrite preserved dealer profile fields", () => {
    const source = readFileSync(join(process.cwd(), "prisma", "seed", "apply.ts"), "utf-8");
    expect(source).toMatch(
      /if \(dealer\.preservedUserId && dealer\.preservedDealerId\) \{\s*return \{ userId: dealer\.preservedUserId/,
    );
    expect(source).not.toMatch(/dealerProfile\.update/);
  });

  it("does not import Supabase admin APIs from seed modules", () => {
    const seedDir = join(process.cwd(), "prisma", "seed");
    const files = [
      join(process.cwd(), "prisma", "seed.ts"),
      ...readdirSync(seedDir).map((name) => join(seedDir, name)),
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf-8");
      expect(source).not.toMatch(/@supabase\//);
    }
  });
});

describe("SEED-WIPE-001", () => {
  it("keeps the ordered allowlist off the denylist", () => {
    const plan = getWipePlan();
    expect(plan.order[0]).toBe("DealerReviewModerationEvent");
    expect(plan.order.at(-1)).toBe("User");
    expect(plan.denylist).toEqual(
      expect.arrayContaining([
        "WaitlistUser",
        "ContentPage",
        "SiteSetting",
        "PaymentWebhookInbox",
        "RetentionLegalHold",
        "Region",
        "Category",
        "AttributeDefinition",
      ]),
    );
    expect(() => assertWipePlanBoundaries()).not.toThrow();
    expect(plan.order.some((table) => plan.denylist.includes(table as never))).toBe(
      false,
    );
  });
});
