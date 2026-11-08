// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useStockReviewLayout } from "@/app/(admin)/admin/stock-reviews/use-review-layout";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });
it.each([true, false])("scrolls the correct target only when opening a result (wide=%s)", wide => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query.includes("min-width") && wide,
    addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList));
  const panel = document.createElement("aside"); panel.id = "stock-review-pane";
  const card = document.createElement("li"); card.id = "stock-review-result-report-1";
  panel.scrollIntoView = vi.fn(); card.scrollIntoView = vi.fn(); document.body.append(panel, card);
  const { result, rerender } = renderHook(() => useStockReviewLayout(null, "active"));
  expect(panel.scrollIntoView).not.toHaveBeenCalled(); expect(card.scrollIntoView).not.toHaveBeenCalled();
  act(() => result.current.toggle("report-1"));
  const target = wide ? panel : card;
  expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
  expect((wide ? card : panel).scrollIntoView).not.toHaveBeenCalled();
  rerender(); act(() => result.current.toggle("report-1"));
  expect(target.scrollIntoView).toHaveBeenCalledTimes(1);
});
