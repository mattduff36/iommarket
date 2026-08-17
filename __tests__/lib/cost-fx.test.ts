import { describe, expect, it, vi } from "vitest";
import { CostFxError, fetchFrankfurterRate, getOrCreateUsdGbpRate } from "@/lib/costs/fx";
import { previousBusinessDay } from "@/lib/costs/dates";

describe("COST-FX-002 FX snapshots", () => {
  it("uses the previous business day for weekend capture dates", () => {
    expect(previousBusinessDay("2026-08-16")).toBe("2026-08-14");
    expect(previousBusinessDay("2026-08-15")).toBe("2026-08-14");
    expect(previousBusinessDay("2026-08-14")).toBe("2026-08-14");
  });

  it("parses a Frankfurter USD/GBP quote", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ date: "2026-08-14", rates: { GBP: 0.74 } }),
    });
    await expect(fetchFrankfurterRate("2026-08-14", fetchImpl)).resolves.toEqual({
      rate: "0.74",
      effectiveDate: "2026-08-14",
    });
  });

  it("rejects a zero FX rate", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ date: "2026-08-14", rates: { GBP: 0 } }),
    });
    await expect(fetchFrankfurterRate("2026-08-14", fetchImpl)).rejects.toBeInstanceOf(
      CostFxError,
    );
  });

  it("fails closed when no FX rate is available", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const client = {
      fxRateSnapshot: {
        findFirst: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
    };

    await expect(
      getOrCreateUsdGbpRate(client, new Date("2026-08-14T00:00:00.000Z"), fetchImpl),
    ).rejects.toBeInstanceOf(CostFxError);
    expect(client.fxRateSnapshot.upsert).not.toHaveBeenCalled();
  });
});
