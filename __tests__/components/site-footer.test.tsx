import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SiteFooter } from "@/components/layout/site-footer";
import { FOOTER_NAV_ITEMS } from "@/lib/navigation";

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span aria-label={alt} role="img" />,
}));

describe("SiteFooter", () => {
  it("shows footer links between the logo and legal copy on every viewport", () => {
    render(<SiteFooter />);

    const footer = screen.getByRole("contentinfo");
    const logo = within(footer).getByRole("link", { name: /iTrader\.im/i });
    const nav = within(footer).getByRole("navigation", { name: "Footer" });
    const legal = within(footer).getByText(/All rights reserved/i);

    expect(nav.className.split(/\s+/)).not.toContain("hidden");
    expect(logo.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(nav.compareDocumentPosition(legal) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    for (const item of FOOTER_NAV_ITEMS) {
      expect(within(nav).getByRole("link", { name: item.label })).toHaveAttribute(
        "href",
        item.href,
      );
    }
  });
});
