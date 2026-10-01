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
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ version: "first" }) });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
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
