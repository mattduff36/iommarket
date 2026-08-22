import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomeVehicleCheck } from "@/components/vehicle-check/home-vehicle-check";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("HomeVehicleCheck plate text", () => {
  it("keeps the placeholder registration on a single line", () => {
    render(<HomeVehicleCheck />);

    const placeholder = screen.getByText("REG 123");
    expect(placeholder).toHaveClass("whitespace-nowrap");
    expect(placeholder.className).not.toMatch(/break-words|break-all/);
  });
});
