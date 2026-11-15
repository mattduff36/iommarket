// @vitest-environment jsdom
import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { refresh, fetchMock, navigation } = vi.hoisted(() => ({ refresh: vi.fn(), fetchMock: vi.fn(), navigation: { path: "/account/listings" } }));
const router = { refresh };
vi.mock("next/navigation", () => ({ usePathname: () => navigation.path, useRouter: () => router }));
import { LiveAccountUpdates, shouldWatchAccountPage } from "@/components/account/live-account-updates";

describe("background account updates", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.clearAllMocks();
    navigation.path = "/account/listings";
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ version: "first" }) });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("backs off failed polls and resets after a successful response", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await act(async () => { render(<LiveAccountUpdates />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ version: "first" }) });
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("does not poll offline and resumes on reconnect", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    await act(async () => { render(<LiveAccountUpdates />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock).not.toHaveBeenCalled();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("aborts a hung poll and can poll again after its deadline", async () => {
    fetchMock.mockImplementation((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    }));
    await act(async () => { render(<LiveAccountUpdates />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetchMock.mock.calls[0][1].signal.reason.name).toBe("TimeoutError");
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("refreshes only after a changed version and stops when hidden", async () => {
    await act(async () => { render(<LiveAccountUpdates />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(refresh).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ version: "second" }) });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(refresh).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    fireEvent(document, new Event("visibilitychange"));
    const count = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(fetchMock).toHaveBeenCalledTimes(count);
  });
  it("preserves unsaved forms and announces waiting updates", async () => {
    await act(async () => { render(<><LiveAccountUpdates /><form><input aria-label="Draft" /></form></>); });
    fireEvent.input(screen.getByLabelText("Draft"), { target: { value: "unsaved" } });
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ version: "changed" }) });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Updates are available");
    expect(screen.getByLabelText("Draft")).toHaveValue("unsaved");
  });
  it("does not watch checkout or profile editing routes", () => {
    expect(shouldWatchAccountPage("/sell/checkout")).toBe(false);
    expect(shouldWatchAccountPage("/dealer/profile")).toBe(false);
    expect(shouldWatchAccountPage("/account/profile")).toBe(false);
    expect(shouldWatchAccountPage("/admin/users/member-id")).toBe(true);
  });
});
