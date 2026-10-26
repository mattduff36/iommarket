/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { PublicReadStatusError, retryPublicRead } from "@/scripts/dealer-stock-sync/public-read-retry";
import { fetchPageHtml, gotoPublicPage } from "@/scripts/dealer-stock-sync/browse";
import type { Page } from "@playwright/test";

describe("public read retries", () => {
  it("allows the initial list document to settle but never accepts a blocked detail response", async () => {
    const response = { ok: () => false, status: () => 403 };
    const page = { goto: vi.fn(async () => response) } as unknown as Page;
    expect(await gotoPublicPage(page, "https://dealer.example/stock", true)).toBe(response);
    await expect(gotoPublicPage(page, "https://dealer.example/car")).rejects.toMatchObject({ status: 403 });
    expect(page.goto).toHaveBeenCalledTimes(4);
  });
  it("retries twice then returns a recovered read", async () => {
    const read = vi.fn().mockRejectedValueOnce(new PublicReadStatusError(503))
      .mockRejectedValueOnce(new Error("fetch failed")).mockResolvedValue("page");
    const wait = vi.fn(async () => {});
    expect(await retryPublicRead(read, wait)).toBe("page");
    expect(read).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toHaveLength(2);
  });
  it("exhausts retries without hiding failure", async () => {
    const read = vi.fn().mockRejectedValue(new PublicReadStatusError(429));
    await expect(retryPublicRead(read, async () => {})).rejects.toMatchObject({ status: 429 });
    expect(read).toHaveBeenCalledTimes(3);
  });
  it.each([401, 404])("does not retry permanent HTTP %s", async status => {
    const read = vi.fn().mockRejectedValue(new PublicReadStatusError(status));
    await expect(retryPublicRead(read, async () => {})).rejects.toMatchObject({ status });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("sets a finite abort signal and rejects a missing page", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response("missing", { status: 404 }));
    await expect(fetchPageHtml("https://dealer.example/car", fetcher)).rejects.toMatchObject({ status: 404 });
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
