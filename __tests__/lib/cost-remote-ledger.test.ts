import { afterEach, describe, expect, it, vi } from "vitest";
import { requestRemoteCostRefresh, requestRemoteManualCost } from "@/lib/costs/remote-ledger";

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

describe("remote manual cost", () => {
  it("posts the signed amount to the canonical ledger", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: { recorded: true } }));
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      category: "OTHER" as const,
      externalRef: "exclude-costs-page",
      nativeAmount: "-12.50",
      nativeCurrency: "GBP" as const,
      displayLabel: "Exclude costs page work",
      periodStart: "2026-08-17T00:00:00.000Z",
      periodEnd: "2026-09-27T00:00:00.000Z",
    };

    await requestRemoteManualCost("https://itrader.im", input, env);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://itrader.im/api/internal/cost-ledger/manual",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  });

  it("reports a missing live manual-cost endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html></html>", { status: 404 })));

    await expect(
      requestRemoteManualCost(
        "https://itrader.im",
        {
          category: "OTHER",
          externalRef: "exclude-costs-page",
          nativeAmount: "-12.50",
          nativeCurrency: "GBP",
          displayLabel: "Exclude costs page work",
          periodStart: "2026-08-17T00:00:00.000Z",
          periodEnd: "2026-09-27T00:00:00.000Z",
        },
        env,
      ),
    ).rejects.toThrow("not deployed");
  });

  it("surfaces a live ledger rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "Cost is before the ledger launch boundary." }, { status: 409 })),
    );

    await expect(
      requestRemoteManualCost(
        "https://itrader.im",
        {
          category: "OTHER",
          externalRef: "exclude-costs-page",
          nativeAmount: "-1.00",
          nativeCurrency: "GBP",
          displayLabel: "Exclude costs page work",
          periodStart: "2026-08-17T00:00:00.000Z",
          periodEnd: "2026-09-27T00:00:00.000Z",
        },
        env,
      ),
    ).rejects.toThrow("ledger launch boundary");
  });
});
