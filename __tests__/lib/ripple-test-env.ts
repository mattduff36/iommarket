import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";

export const RIPPLE_TEST_CLIENT_ID = "codelabplatfdcf3a8";
export const RIPPLE_TEST_WEBHOOK_SECRET = "ripple-webhook-secret-for-tests-32ch";
export const RIPPLE_TEST_REFERENCE_SECRET =
  "ripple-reference-secret-256bit-minimum-value";

export function installRippleTestEnv() {
  process.env.RIPPLE_CLIENT_ID = RIPPLE_TEST_CLIENT_ID;
  process.env.RIPPLE_WEBHOOK_SECRET = RIPPLE_TEST_WEBHOOK_SECRET;
  process.env.RIPPLE_REFERENCE_SECRET = RIPPLE_TEST_REFERENCE_SECRET;
  process.env.RIPPLE_LIVE_CHECKOUT_ENABLED = "1";
  process.env.RIPPLE_LISTING_PAYMENT_URL = `https://portal.startyourripple.co.uk/card/${RIPPLE_TEST_CLIENT_ID}/pay/${RIPPLE_CANONICAL_PRODUCTS.listing.code}`;
  process.env.RIPPLE_FEATURED_PAYMENT_URL = `https://portal.startyourripple.co.uk/card/${RIPPLE_TEST_CLIENT_ID}/pay/${RIPPLE_CANONICAL_PRODUCTS.featured.code}`;
  process.env.RIPPLE_DEALER_STARTER_URL = `https://portal.startyourripple.co.uk/card/${RIPPLE_TEST_CLIENT_ID}/pay/${RIPPLE_CANONICAL_PRODUCTS.starter.code}`;
  process.env.RIPPLE_DEALER_PRO_URL = `https://portal.startyourripple.co.uk/card/${RIPPLE_TEST_CLIENT_ID}/pay/${RIPPLE_CANONICAL_PRODUCTS.pro.code}`;
}

export function rippleEnvelope(overrides: {
  event?: string;
  data?: Record<string, unknown>;
  timestamp?: string;
} = {}) {
  return {
    event: overrides.event ?? "payment.received",
    client_id: RIPPLE_TEST_CLIENT_ID,
    timestamp: overrides.timestamp ?? "2026-08-15T10:15:27.345Z",
    data: {
      amount: 4.99,
      currency: "GBP",
      customer_email: "buyer@example.com",
      customer_name: "A Buyer",
      description: "Private listing fee",
      link_code: RIPPLE_CANONICAL_PRODUCTS.listing.code,
      link_type: "one-off",
      payment_reference: "260821000161456468",
      recurring: false,
      ...overrides.data,
    },
  };
}
