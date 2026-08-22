import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FooterNav } from "@/components/layout/footer-nav";

const items = [
  { href: "/one", label: "One" },
  { href: "/two", label: "Two" },
  { href: "/three", label: "Three" },
];

function mockLineStarts(topsByLabel: Record<string, number>) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function mockRect(this: HTMLElement) {
      const top = topsByLabel[this.textContent ?? ""] ?? 0;
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        right: 48,
        bottom: top + 16,
        width: 48,
        height: 16,
        toJSON: () => ({}),
      };
    },
  );
}

describe("FooterNav", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hides dots at the start and end of a wrapped line", () => {
    mockLineStarts({ One: 8, Two: 8, Three: 32 });
    render(<FooterNav items={items} />);

    const dots = screen.getAllByText("·");
    expect(dots).toHaveLength(2);
    expect(dots[0]).toHaveClass("opacity-100");
    expect(dots[1]).toHaveClass("opacity-0");
  });

  it("recomputes dots when the window is resized", () => {
    mockLineStarts({ One: 8, Two: 8, Three: 8 });
    render(<FooterNav items={items} />);
    expect(screen.getAllByText("·")[1]).toHaveClass("opacity-100");

    mockLineStarts({ One: 8, Two: 8, Three: 32 });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(screen.getAllByText("·")[1]).toHaveClass("opacity-0");
  });
});
