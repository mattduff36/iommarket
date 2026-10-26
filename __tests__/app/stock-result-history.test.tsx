// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { StockResultHistory, StockResultVisibility } from "@/app/(admin)/admin/stock-reviews/result-history";

function Results({ clearable = ["finished"] }: { clearable?: string[] }) {
  return <StockResultHistory adminId="admin" clearableIds={clearable}>
    <StockResultVisibility ids={["finished"]}><p>Applied result</p></StockResultVisibility>
    <StockResultVisibility ids={["pending"]}><p>Pending review</p></StockResultVisibility>
    <StockResultVisibility ids={["running"]}><p>Running job</p></StockResultVisibility>
  </StockResultHistory>;
}
beforeEach(() => localStorage.clear());
describe("result clearing", () => {
  it("clears completed results, retains pending/active work and restores history", async () => {
    const view = render(<Results />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Clear completed results" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Clear completed results" }));
    expect(screen.queryByText("Applied result")).not.toBeInTheDocument();
    expect(screen.getByText("Pending review")).toBeInTheDocument();
    expect(screen.getByText("Running job")).toBeInTheDocument();
    view.unmount();
    render(<Results />);
    await waitFor(() => expect(screen.queryByText("Applied result")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Show cleared results/ }));
    expect(screen.getByText("Applied result")).toBeInTheDocument();
  });
  it("never hides a result that is active again", async () => {
    localStorage.setItem("stock-review-hidden:v1:admin", JSON.stringify(["running"]));
    render(<Results />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Clear completed results" })).toBeEnabled());
    expect(screen.getByText("Running job")).toBeInTheDocument();
  });
});
