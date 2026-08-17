import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DealerIdentityLink } from "@/components/dealers/dealer-identity-link";

describe("DealerIdentityLink", () => {
  it("makes the dealer identity and stock destination one clear link", () => {
    const { container } = render(
      <DealerIdentityLink
        name="Alpha Autos"
        slug="alpha-autos"
        verified
      />,
    );

    const link = screen.getByRole("link", {
      name: "View Alpha Autos dealer profile",
    });
    expect(link).toHaveAttribute("href", "/dealers/alpha-autos");
    expect(link).toHaveTextContent("Alpha Autos");
    expect(link).toHaveTextContent("View dealer profile and all listings");
    expect(link).toHaveTextContent("Verified dealer");
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(link.querySelector("a, button")).toBeNull();
  });
});
