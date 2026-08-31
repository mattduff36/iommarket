import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Checkbox } from "@/components/ui/checkbox";

describe("Checkbox FE-09", () => {
  it("exposes aria-invalid and visible error text", () => {
    render(
      <Checkbox
        label="I want launch updates from iTrader.im."
        error="Tick this box to confirm you want launch updates. You cannot join the waiting list without it."
      />,
    );

    const checkbox = screen.getByRole("checkbox");
    const errorText = screen.getByText(
      "Tick this box to confirm you want launch updates. You cannot join the waiting list without it.",
    );

    expect(checkbox).toHaveAttribute("aria-invalid", "true");
    expect(checkbox).toHaveAttribute("aria-describedby", errorText.id);
    expect(errorText).toBeVisible();
  });
});
