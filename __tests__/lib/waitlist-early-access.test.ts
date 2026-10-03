import { describe, expect, it, vi } from "vitest";
import {
  isEligibleEarlyAccessWaitlistUser,
  waitlistInterestsIncludeCars,
} from "@/lib/waitlist/early-access/audience";
import { canSendEarlyAccessBulk, canSendEarlyAccessTest } from "@/lib/waitlist/early-access/guard";
import { inviteIsClaimable } from "@/lib/waitlist/early-access/invite";
import {
  buildEarlyAccessClaimUrl,
  earlyAccessInviteMatches,
  issueEarlyAccessClaimCookie,
  readEarlyAccessClaimCookie,
  signEarlyAccessInvite,
} from "@/lib/waitlist/early-access/tokens";

const SECRET = "0123456789abcdef0123456789abcdef";
const NOW = Date.parse("2026-10-01T18:00:00.000Z");

describe("early-access audience", () => {
  it("includes either car interest and excludes dealer-only or withdrawn consent", () => {
    expect(waitlistInterestsIncludeCars(["DEALER", "BUYING_CARS"])).toBe(true);
    expect(waitlistInterestsIncludeCars(["SELLING_CARS"])).toBe(true);
    expect(waitlistInterestsIncludeCars(["DEALER"])).toBe(false);
    expect(waitlistInterestsIncludeCars("BUYING_CARS")).toBe(false);
    expect(
      isEligibleEarlyAccessWaitlistUser({
        deletedAt: null,
        marketingConsentAt: new Date(),
        marketingWithdrawnAt: null,
        interests: ["BUYING_CARS"],
      }),
    ).toBe(true);
    expect(
      isEligibleEarlyAccessWaitlistUser({
        deletedAt: null,
        marketingConsentAt: null,
        marketingWithdrawnAt: null,
        interests: ["SELLING_CARS"],
      }),
    ).toBe(false);
    expect(
      isEligibleEarlyAccessWaitlistUser({
        deletedAt: null,
        marketingConsentAt: new Date(),
        marketingWithdrawnAt: new Date(),
        interests: ["SELLING_CARS"],
      }),
    ).toBe(false);
  });
});

describe("early-access delivery guard", () => {
  it("allows bulk delivery only on closed production and tests on closed or preview runtimes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T08:00:00Z"));
    expect(canSendEarlyAccessBulk({ VERCEL_ENV: "production" })).toBe(true);
    expect(
      canSendEarlyAccessBulk({ VERCEL_ENV: "production", PRODUCTION_LAUNCH_ENABLED: "1" }),
    ).toBe(false);
    expect(canSendEarlyAccessBulk({ VERCEL_ENV: "preview" })).toBe(false);
    expect(
      canSendEarlyAccessBulk({ VERCEL_ENV: "preview", PREVIEW_LAUNCH_GATE_QA: "1" }),
    ).toBe(false);
    expect(canSendEarlyAccessTest({ VERCEL_ENV: "preview" })).toBe(true);
    expect(canSendEarlyAccessTest({ VERCEL_ENV: "production" })).toBe(true);
    expect(canSendEarlyAccessTest({ PRODUCTION_LAUNCH_ENABLED: "1" })).toBe(true);
    expect(
      canSendEarlyAccessTest({ VERCEL_ENV: "production", PRODUCTION_LAUNCH_ENABLED: "1" }),
    ).toBe(false);
    vi.useRealTimers();
  });
});

describe("early-access invite tokens", () => {
  const input = { secret: SECRET, recipientId: "recipient-1", nonce: "nonce-1" };

  it("rejects tampered proofs and binds the claim cookie to the nonce", () => {
    const proof = signEarlyAccessInvite(input);
    expect(proof).toBeTruthy();
    expect(earlyAccessInviteMatches(proof ?? "", input)).toBe(true);
    expect(earlyAccessInviteMatches(`${proof}x`, input)).toBe(false);
    expect(earlyAccessInviteMatches(proof ?? "", { ...input, nonce: "other" })).toBe(false);
    expect(buildEarlyAccessClaimUrl("https://itrader.im", "recipient-1", proof ?? "")).toBe(
      `https://itrader.im/early-access?recipient=recipient-1&proof=${proof}`,
    );

    const cookie = issueEarlyAccessClaimCookie({ ...input, now: NOW });
    expect(
      readEarlyAccessClaimCookie(cookie?.value, { ...input, now: NOW }),
    ).toBe(true);
    expect(
      readEarlyAccessClaimCookie(cookie?.value, { ...input, nonce: "other", now: NOW }),
    ).toBe(false);
    expect(
      readEarlyAccessClaimCookie(cookie?.value, {
        ...input,
        now: NOW + 22 * 60 * 1000,
      }),
    ).toBe(false);
  });

  it("does not treat a sent link as claimed before signup", () => {
    const proof = signEarlyAccessInvite(input) ?? "";
    const record = {
      id: "recipient-1",
      nonce: "nonce-1",
      deliveryStatus: "SENT",
      claimedAt: null,
      waitlistUser: { email: "member@example.com" },
      testAdmin: null,
    };
    expect(inviteIsClaimable(record, proof, SECRET)).toBe(true);
    expect(inviteIsClaimable({ ...record, claimedAt: new Date(NOW) }, proof, SECRET)).toBe(false);
    expect(inviteIsClaimable({ ...record, deliveryStatus: "PENDING" }, proof, SECRET)).toBe(false);
  });
});
