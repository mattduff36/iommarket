import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  retry: vi.fn(),
  stale: vi.fn(),
}));

vi.mock("@/lib/ops/safety", () => ({
  isCronAuthorized: () => true,
}));
vi.mock("@/lib/payments/ripple-inbox", () => ({
  retryFailedRippleWebhooks: mocks.retry,
}));
vi.mock("@/lib/payments/stale-attempts", () => ({
  detectStalePaymentAttempts: mocks.stale,
}));

import { GET } from "@/app/api/cron/ripple-webhook-retry/route";

describe("Ripple retry maintenance ordering", () => {
  it("PAY-CRON-003 finishes webhook replay before stale detection", async () => {
    const order: string[] = [];
    mocks.retry.mockImplementation(async () => {
      order.push("replay");
      return { processed: 1 };
    });
    mocks.stale.mockImplementation(async () => {
      order.push("stale");
      return { reviewed: 0, alerted: 0 };
    });

    const response = await GET(
      new NextRequest("https://example.test/api/cron/ripple-webhook-retry"),
    );

    expect(response.status).toBe(200);
    expect(order).toEqual(["replay", "stale"]);
  });
});
