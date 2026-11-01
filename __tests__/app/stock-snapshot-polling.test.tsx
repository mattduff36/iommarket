// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStockSnapshot } from "@/app/(admin)/admin/stock-reviews/use-stock-snapshot";

type Snapshot = { version: number };
const initial: Snapshot = { version: 1 };
const valid = (value: unknown): value is Snapshot => Boolean(value && typeof value === "object" &&
  "version" in value && typeof value.version === "number");
const response = (value: unknown = { version: 2 }) => ({ ok: true, json: async () => value });
const safe = () => true;
const tick = (ms = 5_000) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("stock snapshot polling", () => {
  it("uses a slower idle cadence while manual refresh remains immediate", async () => {
    const { result } = renderHook(() => useStockSnapshot(initial, safe, valid, () => 60_000));
    await tick(55_000);
    expect(fetch).not.toHaveBeenCalled();
    await tick();
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => result.current.reload());
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["network", "http", "json", "shape"])("retains saved results after %s failure and recovers", async failure => {
    const fetchMock = vi.mocked(fetch);
    if (failure === "network") fetchMock.mockRejectedValueOnce(new TypeError("network error"));
    if (failure === "http") fetchMock.mockResolvedValueOnce({ ok: false } as Response);
    if (failure === "json") fetchMock.mockResolvedValueOnce({ ok: true, json: async () => { throw new SyntaxError("invalid"); } } as unknown as Response);
    if (failure === "shape") fetchMock.mockResolvedValueOnce(response({ error: "unauthorized" }) as Response);
    const { result } = renderHook(() => useStockSnapshot(initial, safe, valid));
    await tick();
    expect(result.current.snapshot).toBe(initial);
    expect(result.current.connectionLost).toBe(true);
    await tick(10_000);
    expect(result.current.snapshot).toEqual({ version: 2 });
    expect(result.current.connectionLost).toBe(false);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/admin/stock-reviews/snapshot", expect.objectContaining({ credentials: "same-origin", cache: "no-store" }));
  });

  it("times out a stalled body and ignores its late response", async () => {
    const body = pending<Snapshot>();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: () => body.promise } as Response);
    const { result } = renderHook(() => useStockSnapshot(initial, safe, valid));
    await tick();
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    await tick(10_000);
    expect(signal?.aborted).toBe(true);
    expect(result.current.connectionLost).toBe(true);
    expect(result.current.snapshot).toBe(initial);
    await act(async () => { result.current.reload(); });
    expect(result.current.snapshot).toEqual({ version: 2 });
    await act(async () => body.resolve({ version: 99 }));
    expect(result.current.snapshot).toEqual({ version: 2 });
  });

  it("allows only one read at a time and queues a manual reload", async () => {
    const first = pending<Response>();
    vi.mocked(fetch).mockReturnValueOnce(first.promise);
    const { result } = renderHook(() => useStockSnapshot(initial, safe, valid));
    await tick();
    await tick();
    act(() => { result.current.reload(); result.current.reload(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve(response() as Response));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps only the latest deferred snapshot until editing is safe", async () => {
    let canCommit = false;
    const { result } = renderHook(() => useStockSnapshot(initial, () => canCommit, valid));
    await tick();
    expect(result.current.snapshot).toBe(initial);
    vi.mocked(fetch).mockResolvedValue(response({ version: 3 }) as Response);
    await tick();
    expect(result.current.snapshot).toBe(initial);
    canCommit = true;
    vi.mocked(fetch).mockRejectedValue(new TypeError("offline"));
    await tick();
    expect(result.current.snapshot).toEqual({ version: 3 });
    expect(result.current.connectionLost).toBe(true);
  });

  it("does not poll hidden pages and refreshes when visible again", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const { result } = renderHook(() => useStockSnapshot(initial, safe, valid));
    await tick();
    expect(fetch).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current.snapshot).toEqual({ version: 2 });
  });

  it("aborts reads on unmount without scheduling more work", async () => {
    const first = pending<Response>();
    vi.mocked(fetch).mockReturnValueOnce(first.promise);
    const { unmount } = renderHook(() => useStockSnapshot(initial, safe, valid));
    await tick();
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => first.resolve(response() as Response));
    await tick(20_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("adopts new server props and prevents an older read overwriting them", async () => {
    const first = pending<Response>();
    vi.mocked(fetch).mockReturnValueOnce(first.promise);
    const { result, rerender } = renderHook(({ value }) => useStockSnapshot(value, safe, valid), { initialProps: { value: initial } });
    await tick();
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    rerender({ value: { version: 4 } });
    expect(signal?.aborted).toBe(true);
    expect(result.current.snapshot).toEqual({ version: 4 });
    await act(async () => first.resolve(response({ version: 99 }) as Response));
    expect(result.current.snapshot).toEqual({ version: 4 });
  });
});
