/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { catchUpCostLedger } from "@/scripts/cost-ledger-catch-up";

function refreshResponse(data: Record<string, unknown>, status = 200) {
  return Response.json({ data }, { status });
}

describe("cost ledger catch-up script", () => {
  it("continues through partial, historical, and locked responses", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        refreshResponse({ status: "partial", caughtUp: false }),
      )
      .mockResolvedValueOnce(
        refreshResponse({ status: "succeeded", caughtUp: false }),
      )
      .mockResolvedValueOnce(refreshResponse({ status: "locked" }))
      .mockResolvedValueOnce(
        refreshResponse({
          status: "succeeded",
          caughtUp: true,
          queryTo: "2026-09-27T21:00:00.000Z",
        }),
      );
    const wait = vi.fn().mockResolvedValue(undefined);
    const onProgress = vi.fn();

    await expect(
      catchUpCostLedger({
        origin: "https://itrader.im/",
        secret: "request-secret",
        fetchImpl,
        wait,
        onProgress,
      }),
    ).resolves.toMatchObject({
      status: "succeeded",
      caughtUp: true,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://itrader.im/api/internal/cost-ledger/refresh",
      expect.objectContaining({
        method: "POST",
        headers: { authorization: "Bearer request-secret" },
      }),
    );
    expect(wait).toHaveBeenCalledWith(10_000);
    expect(onProgress).toHaveBeenCalledTimes(4);
  });

  it("stops on a real refresh failure or the request limit", async () => {
    await expect(
      catchUpCostLedger({
        origin: "https://itrader.im",
        secret: "request-secret",
        fetchImpl: vi.fn().mockResolvedValue(
          refreshResponse({
            status: "failed",
            errorCode: "P2028",
            message: "Provider refresh failed.",
          }),
        ),
      }),
    ).rejects.toThrow("Provider refresh failed.");

    await expect(
      catchUpCostLedger({
        origin: "https://itrader.im",
        secret: "request-secret",
        maxAttempts: 2,
        fetchImpl: vi.fn().mockImplementation(() =>
          Promise.resolve(
            refreshResponse({ status: "partial", caughtUp: false }),
          ),
        ),
      }),
    ).rejects.toThrow("exceeded 2 requests");
  });
});
