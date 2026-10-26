/* @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ launch: vi.fn(), close: vi.fn(), onRequest: null as null | ((request: unknown) => void) }));
vi.mock("@playwright/test", () => ({ chromium: { launch: fake.launch } }));
import { capturePublicListRequest } from "@/scripts/dealer-stock-sync/browse";

beforeEach(() => {
  vi.useFakeTimers();
  fake.onRequest = null;
  fake.close.mockClear();
  const page = {
    on: (event: string, listener: (request: unknown) => void) => { if (event === "request") fake.onRequest = listener; },
    goto: vi.fn(async () => ({ ok: () => true })),
    getByRole: () => ({ first: () => ({ count: async () => 0 }) }),
  };
  fake.launch.mockResolvedValue({
    newContext: async () => ({ newPage: async () => page, close: fake.close }), close: fake.close,
  });
});
afterEach(() => vi.useRealTimers());

it("captures a delayed stock request using the visible browser and closes it", async () => {
  const result = capturePublicListRequest("https://dealer.example/search", request => request.url.endsWith("/vehicle-search"));
  await vi.advanceTimersByTimeAsync(4_000);
  fake.onRequest?.({ url: () => "https://dealer.example/vehicle-search", method: () => "POST", headers: () => ({}), postData: () => "getAll" });
  await vi.advanceTimersByTimeAsync(250);
  expect((await result)?.url).toBe("https://dealer.example/vehicle-search");
  expect(fake.launch).toHaveBeenCalledWith({ headless: false });
  expect(fake.close).toHaveBeenCalledTimes(2);
});

it("finishes without inventory when no matching request appears", async () => {
  const result = capturePublicListRequest("https://dealer.example/search", () => false);
  await vi.advanceTimersByTimeAsync(14_000);
  expect(await result).toBeNull();
  expect(fake.close).toHaveBeenCalledTimes(2);
});
