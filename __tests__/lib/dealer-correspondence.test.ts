import { describe, expect, it } from "vitest";
import {
  correspondenceTokenMatches,
  createCorrespondenceToken,
  hashCorrespondenceToken,
} from "@/lib/dealers/correspondence-token";
import {
  DEALER_EMAIL_CATEGORIES,
  correspondenceRoutingNote,
  resolveCorrespondenceRecipients,
  type DealerCorrespondenceCategory,
} from "@/lib/dealers/correspondence";

const primary = "owner@dealer.example";
const secondary = "sales@dealer.example";

describe("dealer correspondence recipients", () => {
  it("uses the login address when no second address is configured", () => {
    expect(
      resolveCorrespondenceRecipients({
        primaryEmail: " Owner@Dealer.example ",
        category: "BUYER_ENQUIRIES",
        settings: null,
      }),
    ).toEqual(["owner@dealer.example"]);
  });

  it("keeps every category on the login address until the second address is verified", () => {
    for (const category of DEALER_EMAIL_CATEGORIES) {
      expect(
        resolveCorrespondenceRecipients({
          primaryEmail: primary,
          category,
          settings: {
            verifiedEmail: null,
            categories: [category],
            copyAssignedToPrimary: true,
          },
        }),
      ).toEqual([primary]);
    }
  });

  it("sends only selected categories to the verified second address", () => {
    const settings = {
      verifiedEmail: " Sales@Dealer.example ",
      categories: ["BUYER_ENQUIRIES"] as DealerCorrespondenceCategory[],
      copyAssignedToPrimary: false,
    };

    expect(
      resolveCorrespondenceRecipients({
        primaryEmail: primary,
        category: "BUYER_ENQUIRIES",
        settings,
      }),
    ).toEqual([secondary]);
    for (const category of DEALER_EMAIL_CATEGORIES.filter(
      (item) => item !== "BUYER_ENQUIRIES",
    )) {
      expect(
        resolveCorrespondenceRecipients({
          primaryEmail: primary,
          category,
          settings,
        }),
      ).toEqual([primary]);
    }
  });

  it("copies selected categories to the login address only when asked", () => {
    expect(
      resolveCorrespondenceRecipients({
        primaryEmail: primary,
        category: "REVIEWS",
        settings: {
          verifiedEmail: secondary,
          categories: ["REVIEWS"],
          copyAssignedToPrimary: true,
        },
      }),
    ).toEqual([secondary, primary]);
  });

  it("does not duplicate an address that matches the login email", () => {
    expect(
      resolveCorrespondenceRecipients({
        primaryEmail: primary,
        category: "SUBSCRIPTION",
        settings: {
          verifiedEmail: "OWNER@dealer.example",
          categories: ["SUBSCRIPTION"],
          copyAssignedToPrimary: true,
        },
      }),
    ).toEqual([primary]);
  });

  it("returns no recipients when the login address is empty", () => {
    expect(
      resolveCorrespondenceRecipients({
        primaryEmail: "   ",
        category: "DEALER_ACCOUNT",
        settings: {
          verifiedEmail: secondary,
          categories: ["DEALER_ACCOUNT"],
          copyAssignedToPrimary: false,
        },
      }),
    ).toEqual([]);
  });
});

describe("dealer correspondence status copy", () => {
  const now = new Date("2026-09-27T12:00:00Z");

  it("explains that pending confirmation still uses the login address", () => {
    expect(
      correspondenceRoutingNote({
        primaryEmail: primary,
        verifiedEmail: null,
        pendingEmail: secondary,
        verificationExpiresAt: "2026-09-28T12:00:00Z",
        now,
      }),
    ).toContain(`every email still goes to ${primary}`);
  });

  it("keeps the verified address active while a replacement is pending", () => {
    expect(
      correspondenceRoutingNote({
        primaryEmail: primary,
        verifiedEmail: "accounts@dealer.example",
        pendingEmail: secondary,
        verificationExpiresAt: "2026-09-28T12:00:00Z",
        now,
      }),
    ).toContain("continue to go to accounts@dealer.example");
  });

  it("says when a confirmation link has expired", () => {
    expect(
      correspondenceRoutingNote({
        primaryEmail: primary,
        verifiedEmail: null,
        pendingEmail: secondary,
        verificationExpiresAt: "2026-09-26T12:00:00Z",
        now,
      }),
    ).toContain("has expired");
  });
});

describe("dealer correspondence verification tokens", () => {
  it("stores a hash that matches only the issued token", () => {
    const token = createCorrespondenceToken();
    const hash = hashCorrespondenceToken(token);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(correspondenceTokenMatches(token, hash)).toBe(true);
    expect(correspondenceTokenMatches(`${token}x`, hash)).toBe(false);
    expect(correspondenceTokenMatches(token, "not-a-hash")).toBe(false);
    expect(hashCorrespondenceToken(createCorrespondenceToken())).not.toBe(hash);
  });
});
