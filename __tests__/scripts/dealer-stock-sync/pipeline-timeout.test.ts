import { afterEach, describe, expect, it, vi } from "vitest";
import { withSourceTimeout } from "@/scripts/dealer-stock-sync/pipeline";

describe("source timeout cleanup", () => {
  afterEach(() => vi.useRealTimers());

  it("does not keep the manual worker alive after a completed source", async () => {
    vi.useFakeTimers();
    await expect(withSourceTimeout(Promise.resolve("complete"))).resolves.toBe("complete");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the deadline when the source fails early", async () => {
    vi.useFakeTimers();
    await expect(withSourceTimeout(Promise.reject(new Error("source failed")))).rejects.toThrow("source failed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains the 90 second deadline for a source that never settles", async () => {
    vi.useFakeTimers();
    const result = expect(withSourceTimeout(new Promise(() => undefined))).rejects.toThrow("Timed out after 90s");
    await vi.advanceTimersByTimeAsync(90_000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
});
