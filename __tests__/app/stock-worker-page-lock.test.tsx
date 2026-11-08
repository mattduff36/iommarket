// @vitest-environment jsdom
import { useRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StockWorkerPageLock } from "@/app/(admin)/admin/stock-reviews/worker-page-lock";

const warning = "Stock update is running. You can scroll to view progress; use STOP in the footer to stop the worker.";
const notice = () => document.querySelector("[data-stock-worker-warning]");

function Fixture({ active = true, click = vi.fn(), submit = vi.fn() }: { active?: boolean; click?: () => void; submit?: () => void }) {
  const footer = useRef<HTMLElement>(null);
  return <>
    <section data-stock-worker-content="" data-testid="results"><button onClick={click}>Edit result</button>
      <form onSubmit={event => { event.preventDefault(); submit(); }}><input aria-label="Review text" /></form>
    </section>
    <footer ref={footer}><div data-stock-worker-commands=""><button onClick={click}>Stop safely</button></div></footer>
    <StockWorkerPageLock active={active} footer={footer} />
  </>;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("running worker page lock", () => {
  it("shows one neutral, noninteractive warning for a blocked click for exactly 3000ms", () => {
    const click = vi.fn();
    render(<Fixture click={click} />);
    fireEvent.click(screen.getByText("Edit result"));
    expect(click).not.toHaveBeenCalled();
    expect(notice()).toHaveTextContent(warning);
    expect(notice()).toHaveAttribute("data-reportable-error", "false");
    expect(notice()).toHaveStyle({ pointerEvents: "none" });
    expect(notice()?.querySelector("button,a,input")).toBeNull();
    const viewport = document.querySelector<HTMLElement>("[data-stock-worker-warning-viewport]")!;
    const backdrop = document.querySelector<HTMLElement>("[data-stock-worker-backdrop]")!;
    expect(Number(viewport.style.zIndex)).toBeGreaterThan(Number(backdrop.style.zIndex));
    const footer = document.querySelector("footer")!;
    footer.getBoundingClientRect = () => new DOMRect(0, 500, 800, 80);
    fireEvent.resize(window);
    expect(viewport.style.maxHeight).toBe("500px");
    footer.getBoundingClientRect = () => new DOMRect(0, 300, 800, 280);
    fireEvent.resize(window);
    expect(viewport.style.maxHeight).toBe("300px");
    expect(screen.queryByText("Report issue")).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2999); });
    expect(notice()).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(notice()).toBeNull();
  });

  it("restarts the single warning timer without stacking or stealing focus", () => {
    render(<Fixture />);
    const focused = document.activeElement;
    fireEvent.click(screen.getByText("Edit result"));
    act(() => { vi.advanceTimersByTime(2000); });
    fireEvent.click(screen.getByText("Edit result"));
    expect(document.querySelectorAll("[data-stock-worker-warning]")).toHaveLength(1);
    expect(document.activeElement).toBe(focused);
    act(() => { vi.advanceTimersByTime(2999); });
    expect(notice()).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(notice()).toBeNull();
  });

  it("leaves wheel/touch scrolling native and silent while blocking activation, editing and forms", () => {
    const submit = vi.fn();
    render(<Fixture submit={submit} />);
    const results = screen.getByTestId("results");
    expect(results).not.toHaveAttribute("inert");
    expect(document.documentElement.style.overflow).not.toBe("hidden");
    expect(fireEvent.wheel(results, { deltaY: 100 })).toBe(true);
    expect(fireEvent.touchStart(results)).toBe(true);
    expect(fireEvent.touchMove(results)).toBe(true);
    expect(fireEvent.touchEnd(results)).toBe(true);
    expect(notice()).toBeNull();
    const input = screen.getByRole("textbox");
    const editing = new InputEvent("beforeinput", { bubbles: true, cancelable: true, data: "blocked", inputType: "insertText" });
    expect(input.dispatchEvent(editing)).toBe(false);
    fireEvent.submit(input.closest("form")!);
    expect(submit).not.toHaveBeenCalled();
    expect(fireEvent.dragStart(results)).toBe(false);
    expect(fireEvent.drop(results)).toBe(false);
    const stop = screen.getByText("Stop safely");
    const typing = vi.fn();
    stop.addEventListener("keydown", typing);
    stop.addEventListener("keyup", typing);
    fireEvent.keyDown(stop, { key: "a" });
    fireEvent.keyUp(stop, { key: "a" });
    expect(typing).not.toHaveBeenCalled();
    expect(notice()).toBeNull();
  });

  it("keeps footer actions usable without a warning and blocks newly mounted portals", () => {
    const click = vi.fn();
    render(<Fixture click={click} />);
    fireEvent.click(screen.getByText("Stop safely"));
    expect(click).toHaveBeenCalledTimes(1);
    expect(notice()).toBeNull();
    const portal = document.createElement("button");
    portal.addEventListener("click", click);
    document.body.append(portal);
    fireEvent.click(portal);
    expect(click).toHaveBeenCalledTimes(1);
    expect(notice()).toHaveTextContent(warning);
    portal.remove();
  });

  it("dismisses and cancels the warning when unlocked or unmounted", () => {
    const click = vi.fn();
    const view = render(<Fixture click={click} />);
    fireEvent.click(screen.getByText("Edit result"));
    view.rerender(<Fixture active={false} click={click} />);
    expect(notice()).toBeNull();
    fireEvent.click(screen.getByText("Edit result"));
    expect(click).toHaveBeenCalledTimes(1);
    view.rerender(<Fixture click={click} />);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(notice()).toBeNull();
    fireEvent.click(screen.getByText("Edit result"));
    expect(notice()).toBeInTheDocument();
    view.unmount();
    expect(notice()).toBeNull();
    expect(document.querySelector("[data-stock-worker-backdrop]")).toBeNull();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(notice()).toBeNull();
  });

  it("routes ordinary page-scrolling keys to the hovered results container, not page handlers", () => {
    render(<Fixture />);
    const results = screen.getByTestId("results");
    results.style.overflowY = "auto";
    Object.defineProperties(results, { clientHeight: { value: 200 }, scrollHeight: { value: 1200 } });
    const scrollBy = vi.fn();
    results.scrollBy = scrollBy;
    const handler = vi.fn();
    results.addEventListener("keydown", handler);
    fireEvent.pointerMove(results);
    fireEvent.keyDown(results, { key: "PageDown" });
    expect(scrollBy).toHaveBeenCalledWith({ top: 180, left: 0 });
    expect(handler).not.toHaveBeenCalled();
    expect(notice()).toBeNull();
  });
});
