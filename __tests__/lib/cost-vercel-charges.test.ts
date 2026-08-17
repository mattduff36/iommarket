import { describe, expect, it, vi } from "vitest";
import {
  COST_PROVIDER_UNAVAILABLE_CODE,
  CostProviderUnavailableError,
  fetchFocusCharges,
} from "@/lib/costs/vercel";

const env = {
  VERCEL_BILLING_TOKEN: "token",
  COST_VERCEL_TEAM_ID: "team_nNF8inhmRhFvWkaLOl2cwdE6",
  COST_VERCEL_PROJECT_ID: "prj_TFAfJkG9P0osjQpsH2gaNrSPWbCr",
  COST_VERCEL_DATABASE_RESOURCE_ID: "store_1",
} as unknown as NodeJS.ProcessEnv;

const from = new Date("2026-08-13T23:00:00.000Z");
const to = new Date("2026-08-18T00:00:00.000Z");

const chargeRow = {
  ChargePeriodStart: "2026-08-14T00:00:00.000Z",
  ChargePeriodEnd: "2026-08-15T00:00:00.000Z",
  BilledCost: 1.5,
  EffectiveCost: 1.5,
  BillingCurrency: "USD",
  ServiceName: "Functions",
  ServiceProviderName: "Vercel",
  ChargeCategory: "Usage",
  ConsumedQuantity: 1,
  ConsumedUnit: "invocations",
  Tags: { projectId: env.COST_VERCEL_PROJECT_ID },
};

function textResponse(body: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

function abortError() {
  const error = new Error("This operation was aborted");
  error.name = "AbortError";
  return error;
}

const noSleep = async () => {};

describe("FOCUS charge retrieval resilience", () => {
  it("returns parsed rows on the first successful attempt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse(JSON.stringify(chargeRow)));

    const result = await fetchFocusCharges({
      from,
      to,
      env,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.rows).toHaveLength(1);
    expect(result.quarantined).toHaveLength(0);
  });

  it("retries a 503 and succeeds on a later attempt", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(textResponse("service unavailable", 503))
      .mockResolvedValueOnce(textResponse(JSON.stringify(chargeRow)));

    const result = await fetchFocusCharges({
      from,
      to,
      env,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.rows).toHaveLength(1);
  });

  it("retries a timed-out attempt and succeeds on a later attempt", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(abortError())
      .mockResolvedValueOnce(textResponse(JSON.stringify(chargeRow)));

    const result = await fetchFocusCharges({
      from,
      to,
      env,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.rows).toHaveLength(1);
  });

  it("reports the provider as unavailable after exhausting attempts", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse("mutex timeout", 503));

    await expect(
      fetchFocusCharges({
        from,
        to,
        env,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        maxAttempts: 3,
        sleepImpl: noSleep,
      }),
    ).rejects.toBeInstanceOf(CostProviderUnavailableError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("uses a stable error code and never leaks the token or response body", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(abortError());

    let error: CostProviderUnavailableError | null = null;
    try {
      await fetchFocusCharges({
        from,
        to,
        env,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        attemptTimeoutMs: 25_000,
        sleepImpl: noSleep,
      });
    } catch (caught) {
      error = caught as CostProviderUnavailableError;
    }

    expect(error).toBeInstanceOf(CostProviderUnavailableError);
    expect(error?.code).toBe(COST_PROVIDER_UNAVAILABLE_CODE);
    expect(error?.message).not.toContain(env.VERCEL_BILLING_TOKEN);
    expect(error?.message).toContain("timed out");
  });

  it("does not retry an unauthorized response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse("forbidden", 403));

    await expect(
      fetchFocusCharges({
        from,
        to,
        env,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleepImpl: noSleep,
      }),
    ).rejects.toThrow("Vercel billing charges returned 403.");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends the documented ISO date range and team scope", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse(""));

    await fetchFocusCharges({
      from,
      to,
      env,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });

    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.pathname).toBe("/v1/billing/charges");
    expect(url.searchParams.get("from")).toBe(from.toISOString());
    expect(url.searchParams.get("to")).toBe(to.toISOString());
    expect(url.searchParams.get("teamId")).toBe(env.COST_VERCEL_TEAM_ID);
  });
});
