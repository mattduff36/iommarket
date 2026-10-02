// @vitest-environment jsdom
import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LaunchCountdown, launchRelease } from "@/components/holding/launch-countdown";
import { PUBLIC_LAUNCH_AT } from "@/lib/launch/preview-rehearsal";

function digits() {
  return Array.from(screen.getByRole("timer").children).map((tile) => tile.firstElementChild?.textContent);
}

describe("LaunchCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T09:00:00Z"));
  });
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders stable placeholders on the server and initial client render", () => {
    expect(renderToString(<LaunchCountdown />).match(/>--</g)).toHaveLength(4);
    render(<LaunchCountdown />);
    expect(digits()).toEqual(["--", "--", "--", "--"]);
    expect(screen.getByRole("timer")).toHaveAttribute("aria-live", "off");
  });

  it("targets 10:00 BST (09:00 UTC) and counts down across day boundaries", () => {
    render(<LaunchCountdown />);
    act(() => vi.advanceTimersByTime(0));
    expect(digits()).toEqual(["02", "00", "00", "00"]);
    act(() => vi.advanceTimersByTime(1000));
    expect(digits()).toEqual(["01", "23", "59", "59"]);
  });

  it("reaches zero at launch without claiming the gate has opened", () => {
    vi.setSystemTime(new Date("2026-10-03T08:59:59Z"));
    render(<LaunchCountdown />);
    act(() => vi.advanceTimersByTime(0));
    expect(digits()).toEqual(["00", "00", "00", "01"]);
    act(() => vi.advanceTimersByTime(1000));
    expect(digits()).toEqual(["00", "00", "00", "00"]);
    expect(screen.getByRole("status")).toHaveTextContent("Please refresh to check for access.");
  });

  it("clamps an expired launch to zero", () => {
    vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));
    render(<LaunchCountdown />);
    act(() => vi.advanceTimersByTime(1000));
    expect(digits()).toEqual(["00", "00", "00", "00"]);
  });

  it("reloads the preview rehearsal when the clock reaches zero", () => {
    const reload = vi.spyOn(launchRelease, "reload").mockImplementation(() => undefined);
    window.sessionStorage.clear();
    vi.setSystemTime(new Date(PUBLIC_LAUNCH_AT));
    render(<LaunchCountdown opensAt={PUBLIC_LAUNCH_AT} releaseOnZero />);
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByRole("status")).toHaveTextContent("Opening the site…");
    act(() => vi.advanceTimersByTime(0));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(`itrader-preview-launch-release:${PUBLIC_LAUNCH_AT}`)).toBe("1");
    reload.mockRestore();
  });

  it("stops reloading after the rehearsal retries are used", () => {
    const reload = vi.spyOn(launchRelease, "reload").mockImplementation(() => undefined);
    window.sessionStorage.setItem(`itrader-preview-launch-release:${PUBLIC_LAUNCH_AT}`, "12");
    vi.setSystemTime(new Date(PUBLIC_LAUNCH_AT));
    render(<LaunchCountdown opensAt={PUBLIC_LAUNCH_AT} releaseOnZero />);
    act(() => vi.advanceTimersByTime(10_000));
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Please refresh to check for access.");
    reload.mockRestore();
  });

  it("removes scheduled updates when unmounted", () => {
    const { unmount } = render(<LaunchCountdown />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
