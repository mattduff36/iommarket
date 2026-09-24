import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FaqExplorer } from "@/components/faq/faq-explorer";
import { FAQ_CATEGORIES } from "@/lib/faq/content";

describe("FaqExplorer", () => {
  afterEach(() => {
    window.location.hash = "";
  });

  it("renders categories, questions and native disclosure controls", () => {
    render(<FaqExplorer categories={FAQ_CATEGORIES} />);

    expect(screen.getByRole("heading", { name: "Buying a Vehicle" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Dealers" })).toBeVisible();
    const question = screen.getByText("What is iTrader.im?");
    expect(question.closest("summary")).not.toBeNull();
    expect(question.closest("details")).toHaveAttribute("id", "what-is-itrader");
    expect(screen.getAllByRole("link", { name: "pricing page" })[0]).toHaveAttribute(
      "href",
      "/pricing",
    );
    expect(screen.getByRole("link", { name: "how long a private listing stays live" })).toHaveAttribute(
      "href",
      "#how-long-does-a-private-listing-stay-live",
    );
    expect(screen.getByLabelText("Search FAQs")).toBeVisible();
  });

  it("filters by question, answer and category, then restores the full list", () => {
    render(<FaqExplorer categories={FAQ_CATEGORIES} />);
    const search = screen.getByLabelText("Search FAQs");

    fireEvent.change(search, { target: { value: "  REFUND " } });
    expect(screen.getByText("Can I get a refund if my vehicle sells early?")).toBeVisible();
    expect(screen.queryByText("What is iTrader.im?")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "ripple" } });
    expect(screen.getByText("What happens if my payment fails?")).toBeVisible();
    expect(screen.getByText(/Ripple, the payment provider/)).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "MODERATION" } });
    expect(screen.getByRole("heading", { name: "Safety & Moderation" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "About iTrader" })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "zzzz-not-a-real-question" } });
    expect(screen.getByText(/Nothing matched/)).toBeVisible();

    fireEvent.click(screen.getAllByRole("button", { name: "Clear search" })[0]);
    expect(screen.getByText("What is iTrader.im?")).toBeVisible();
    expect(screen.getByRole("heading", { name: "About iTrader" })).toBeVisible();
  });

  it("clears a search that hides the target of a same-page FAQ link", async () => {
    render(<FaqExplorer categories={FAQ_CATEGORIES} />);
    fireEvent.change(screen.getByLabelText("Search FAQs"), {
      target: { value: "number plates" },
    });

    expect(
      screen.queryByText("Can I advertise a Category N or Category S vehicle?"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Category N and Category S" })).toHaveAttribute(
      "href",
      "#can-i-advertise-a-category-n-or-category-s-vehicle",
    );

    window.location.hash = "#can-i-advertise-a-category-n-or-category-s-vehicle";
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    await waitFor(() => {
      expect(screen.getByLabelText("Search FAQs")).toHaveValue("");
    });
    const details = document.getElementById("can-i-advertise-a-category-n-or-category-s-vehicle");
    expect(details).toBeInstanceOf(HTMLDetailsElement);
    expect((details as HTMLDetailsElement).open).toBe(true);
  });

  it("opens a filtered target when the URL hash is already that question", async () => {
    window.location.hash = "#can-i-advertise-a-category-n-or-category-s-vehicle";
    render(<FaqExplorer categories={FAQ_CATEGORIES} />);
    fireEvent.change(screen.getByLabelText("Search FAQs"), {
      target: { value: "number plates" },
    });

    expect(
      screen.queryByText("Can I advertise a Category N or Category S vehicle?"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Category N and Category S" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Search FAQs")).toHaveValue("");
    });
    const details = document.getElementById("can-i-advertise-a-category-n-or-category-s-vehicle");
    expect(details).toBeInstanceOf(HTMLDetailsElement);
    expect((details as HTMLDetailsElement).open).toBe(true);
  });

  it("opens a question targeted by the page hash", () => {
    window.location.hash = "#how-do-i-contact-itrader";
    render(<FaqExplorer categories={FAQ_CATEGORIES} />);

    const details = document.getElementById("how-do-i-contact-itrader");
    expect(details).toBeInstanceOf(HTMLDetailsElement);
    expect((details as HTMLDetailsElement).open).toBe(true);
  });
});
