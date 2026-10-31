// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StockReviewPhoto } from "@/app/(admin)/admin/dealers/[dealerId]/stock-sync/review-photo";

describe("stock review source photo recovery", () => {
  it("advances to the next reviewed image and updates the link after a blocked source", () => {
    render(<StockReviewPhoto photos={["https://www.dwcars.info/blocked.jpg", "https://www.dwcars.info/working.jpg"]} title="Nissan JUKE" />);
    fireEvent.error(screen.getByAltText("Nissan JUKE"));
    expect(screen.getByAltText("Nissan JUKE")).toHaveAttribute("src", "https://www.dwcars.info/working.jpg");
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://www.dwcars.info/working.jpg");
    fireEvent.error(screen.getByAltText("Nissan JUKE"));
    expect(screen.getByText("Source photos unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
