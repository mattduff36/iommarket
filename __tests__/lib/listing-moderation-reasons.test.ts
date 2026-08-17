import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MODERATION_SUB_REASONS,
  MODERATION_TAXONOMY_VERSION,
  getModerationSubReason,
  moderationReasonLabelForHistory,
  moderationSubReasonsForParent,
  validateModerationReason,
} from "@/lib/listings/moderation-reasons";

describe("moderation reasons ALR-LST-003", () => {
  it("requires a reason for adverse actions", () => {
    expect(validateModerationReason({ required: true })).toBe("A reason is required.");
  });

  it("keeps an append-only hierarchical seller-friendly taxonomy MD-MOD-001", () => {
    expect(MODERATION_SUB_REASONS.length).toBeGreaterThan(10);
    expect(moderationSubReasonsForParent("PROHIBITED")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "prohibited.write-off-disclosure",
          parent: "PROHIBITED",
          clauseRefs: expect.arrayContaining(["AUP 4.1-4.2"]),
          retired: false,
        }),
      ]),
    );
    expect(
      getModerationSubReason("prohibited.write-off-disclosure", {
        includeRetired: true,
      }),
    ).not.toBeNull();
  });

  it("hard-fails parent and subreason mismatches MD-MOD-002", () => {
    expect(
      validateModerationReason({
        required: true,
        reasonCode: "FRAUD",
        moderationSubReason: "prohibited.write-off-disclosure",
        moderationTaxonomyVersion: MODERATION_TAXONOMY_VERSION,
      }),
    ).toBe("The moderation reason and subreason do not match.");
  });

  it("requires notes when the reason is Other", () => {
    expect(
      validateModerationReason({
        required: true,
        reasonCode: "OTHER",
        notes: "   ",
      }),
    ).toBe("Notes are required when the reason is Other.");
    expect(
      validateModerationReason({
        required: true,
        reasonCode: "FRAUD",
        notes: "",
      }),
    ).toBeNull();
  });

  it("rejects retired subreasons for new moderation writes", () => {
    expect(
      validateModerationReason({
        required: true,
        reasonCode: "POLICY",
        moderationSubReason: "policy.legacy-general",
        moderationTaxonomyVersion: MODERATION_TAXONOMY_VERSION,
      }),
    ).toBe(
      "The moderation subreason is retired and cannot be used for new decisions.",
    );
    expect(
      moderationSubReasonsForParent("POLICY").some(
        (reason) => reason.code === "policy.legacy-general",
      ),
    ).toBe(false);
    expect(
      moderationReasonLabelForHistory("POLICY", "policy.legacy-general"),
    ).toBe("Legacy general policy issue");
  });

  it("keeps every clause reference anchored to an existing policy section", () => {
    const documents: Record<string, string> = {
      Terms: "terms.md",
      AUP: "acceptable-use.md",
      "Private Seller Terms": "private-seller-terms.md",
      "Dealer Terms": "dealer-terms.md",
    };
    const markdown = Object.fromEntries(
      Object.entries(documents).map(([name, fileName]) => [
        name,
        readFileSync(
          resolve(process.cwd(), "content", "policies", fileName),
          "utf8",
        ),
      ]),
    );

    for (const reason of MODERATION_SUB_REASONS) {
      for (const reference of reason.clauseRefs) {
        const match = reference.match(
          /^(Terms|AUP|Private Seller Terms|Dealer Terms) (\d+)/,
        );
        expect(match, reference).not.toBeNull();
        const [, document, section] = match!;
        expect(markdown[document], reference).toMatch(
          new RegExp(`^## ${section}\\.`, "m"),
        );
      }
    }
  });
});
