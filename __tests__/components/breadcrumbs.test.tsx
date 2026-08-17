import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

describe("Breadcrumbs", () => {
  it("renders an accessible mobile-safe trail without linking the current page", () => {
    const { container } = render(
      <Breadcrumbs
        items={[
          { label: "Dealers", href: "/dealers" },
          { label: "Alpha Autos", href: "/dealers/alpha-autos" },
        ]}
      />,
    );

    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(nav).getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(within(nav).getByRole("link", { name: "Dealers" })).toHaveAttribute(
      "href",
      "/dealers",
    );
    const intermediateLink = within(nav).getByRole("link", {
      name: "Dealers",
    });
    expect(intermediateLink.className).toContain("truncate");
    expect(intermediateLink.parentElement?.className).toContain("max-w-[35vw]");
    expect(
      within(nav).queryByRole("link", { name: "Alpha Autos" }),
    ).toBeNull();
    expect(within(nav).getByText("Alpha Autos")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(nav.className).toContain("overflow-hidden");
    expect(within(nav).getByText("Alpha Autos").className).toContain("truncate");
    expect(
      within(nav).getByText("Alpha Autos").parentElement?.className,
    ).toContain("flex-1");

    const separators = container.querySelectorAll("svg");
    expect(separators).toHaveLength(2);
    for (const separator of separators) {
      expect(separator).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("emits a matching ordered BreadcrumbList with safely escaped labels", () => {
    const unsafeLabel = "</script><script>alert('breadcrumb')</script>";
    const { container } = render(
      <Breadcrumbs
        items={[
          { label: "Buy", href: "/categories" },
          { label: unsafeLabel, href: "/listings/listing-1" },
        ]}
      />,
    );

    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    expect(script?.textContent).not.toContain("</script>");
    expect(script?.textContent).toContain("\\u003c");

    const data = JSON.parse(script?.textContent ?? "{}");
    expect(data.itemListElement).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: buildCanonicalUrl("/"),
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Buy",
        item: buildCanonicalUrl("/categories"),
      },
      {
        "@type": "ListItem",
        position: 3,
        name: unsafeLabel,
        item: buildCanonicalUrl("/listings/listing-1"),
      },
    ]);
  });

  it("suppresses schema for private owner and admin surfaces", () => {
    const { container } = render(
      <Breadcrumbs
        items={[{ label: "Private listing", href: "/sell/private" }]}
        structuredData={false}
      />,
    );

    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeTruthy();
    expect(
      container.querySelector('script[type="application/ld+json"]'),
    ).toBeNull();
  });
});
