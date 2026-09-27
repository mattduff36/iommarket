import { afterEach, describe, expect, it, vi } from "vitest";
import { requestRemoteCostRefresh } from "@/lib/costs/remote-ledger";

const env = {
  ...process.env,
  COST_LEDGER_REQUEST_SECRET: "request-secret",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("remote cost refresh", () => {
  it("distinguishes a missing live route from a provider failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));

    await expect(
      requestRemoteCostRefresh("https://itrader.im", env),
    ).rejects.toThrow("refresh endpoint is not deployed");
  });

  it("distinguishes a live runtime timeout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 504 })));

    await expect(
      requestRemoteCostRefresh("https://itrader.im", env),
    ).rejects.toThrow("refresh timed out");
  });

  it("returns continuation details from the canonical writer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          data: {
            status: "partial",
            message: "Provider costs were partly refreshed.",
            caughtUp: false,
            errorCode: "COST_SYNC_CONTINUE",
          },
        }),
      ),
    );

    await expect(
      requestRemoteCostRefresh("https://itrader.im", env),
    ).resolves.toMatchObject({
      status: "partial",
      caughtUp: false,
      errorCode: "COST_SYNC_CONTINUE",
    });
  });
});
