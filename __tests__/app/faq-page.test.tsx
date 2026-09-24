import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FaqPage, { metadata } from "@/app/(public)/faq/page";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

describe("FAQ page", () => {
  it("renders one H1, the main categories and server-visible answers", () => {
    const { container } = render(<FaqPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Frequently Asked Questions" })).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Selling Privately" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Vehicle Check" })).toBeVisible();
    expect(screen.getByText("What is iTrader.im?")).toBeVisible();
    expect(screen.getByRole("link", { name: "Contact iTrader" })).toHaveAttribute("href", "/contact");
    expect(screen.getByRole("link", { name: "buyer safety guidance" })).toHaveAttribute(
      "href",
      "/safety",
    );
    expect(container.querySelector('script[type="application/ld+json"]')?.textContent).toContain(
      "BreadcrumbList",
    );
    expect(container.innerHTML).not.toContain("FAQPage");
    expect(container.innerHTML).not.toContain("QAPage");
  });

  it("uses the shared canonical origin and does not noindex the page", () => {
    expect(metadata.alternates?.canonical).toBe(buildCanonicalUrl("/faq"));
    expect(metadata.title).toBe(
      "Frequently Asked Questions – Buying & Selling Vehicles on the Isle of Man",
    );
    expect(metadata.description).toMatch(/buying and selling cars, vans, motorbikes and motorhomes/i);
    expect(JSON.stringify(metadata)).not.toMatch(/noindex/i);
  });
});
