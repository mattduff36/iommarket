import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  decodeHostedReturnContext,
  encodeHostedReturnContext,
  HOSTED_RETURN_MAX_AGE_SECONDS,
} from "@/lib/payments/hosted-return-context";

const currentSecret = "current-hosted-return-secret-32-bytes-minimum";
const previousSecret = "previous-hosted-return-secret-32-bytes-minimum";
const baseContext = {
  userId: "user-1",
  paymentId: "payment-1",
  listingId: "listing-1",
  email: "seller@example.com",
  merchantReference: "merchant-ref-1",
  issuedAt: 1_800_000_000_000,
};

describe("hosted payment return context", () => {
  beforeEach(() => {
    vi.stubEnv("RIPPLE_REFERENCE_SECRET", currentSecret);
    vi.stubEnv("RIPPLE_REFERENCE_SECRET_PREVIOUS", "");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects a payload altered after signing", () => {
    const token = encodeHostedReturnContext(baseContext);
    const [payload, mac] = token.split(".");
    const altered = `${Buffer.from(JSON.stringify({ ...baseContext, userId: "attacker" })).toString("base64url")}.${mac}`;

    expect(decodeHostedReturnContext(altered, baseContext.issuedAt)).toBeNull();
    expect(payload).toBeTruthy();
  });

  it("rejects expired and future-issued contexts", () => {
    const expired = encodeHostedReturnContext({
      ...baseContext,
      issuedAt: 1_800_000_000_000,
    });
    expect(
      decodeHostedReturnContext(
        expired,
        baseContext.issuedAt + (HOSTED_RETURN_MAX_AGE_SECONDS + 1) * 1000,
      ),
    ).toBeNull();

    const future = encodeHostedReturnContext({
      ...baseContext,
      issuedAt: baseContext.issuedAt + 1,
    });
    expect(decodeHostedReturnContext(future, baseContext.issuedAt)).toBeNull();
  });

  it("accepts a signature made with the configured previous secret during rotation", () => {
    vi.stubEnv("RIPPLE_REFERENCE_SECRET", previousSecret);
    const oldToken = encodeHostedReturnContext(baseContext);
    vi.stubEnv("RIPPLE_REFERENCE_SECRET", currentSecret);
    vi.stubEnv("RIPPLE_REFERENCE_SECRET_PREVIOUS", previousSecret);

    expect(decodeHostedReturnContext(oldToken, baseContext.issuedAt)).toEqual(baseContext);
  });
});
