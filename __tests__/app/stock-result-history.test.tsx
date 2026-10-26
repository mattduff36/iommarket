// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StockResultHistory, StockResultVisibility, StockResultActions } from "@/app/(admin)/admin/stock-reviews/result-history";
import type { ResultHistoryEntry, ResultHistoryState } from "@/lib/dealer-stock-sync/result-history";

const { change, refresh } = vi.hoisted(() => ({ change: vi.fn(), refresh: vi.fn() }));
vi.mock("@/actions/admin/stock-result-history", () => ({ changeStockResultHistory: change }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/navigation/link", () => ({ default: (props: import("react").ComponentProps<"a">) => <a {...props} /> }));
const entries: ResultHistoryEntry[] = [
  {id:"applied",kind:"report",state:"archived",manageable:true},
  {id:"quiet",kind:"report",state:"active",manageable:true},
  {id:"pending",kind:"report",state:"active",manageable:false},
  {id:"running",kind:"job",state:"active",manageable:false},
];
function Results({ view = "active", rows = entries }: {view?:ResultHistoryState;rows?:ResultHistoryEntry[]}) {
  return <StockResultHistory entries={rows} view={view}>
    {rows.map(row => <StockResultVisibility key={row.id} ids={[row.id]}><section aria-label={row.id}>
      <p>{row.id}</p><StockResultActions id={row.id} />
    </section></StockResultVisibility>)}
  </StockResultHistory>;
}
beforeEach(() => { vi.clearAllMocks(); change.mockResolvedValue({success:true}); });
describe("result history", () => {
  it("hides applied results by default while no-change and active work remain visible", () => {
    render(<Results />);
    expect(screen.queryByText("applied")).not.toBeInTheDocument();
    expect(screen.getByText("quiet")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getAllByRole("button", {name:"Archive"})).toHaveLength(1);
    expect(screen.getByRole("link",{name:"Archived (1)"})).toHaveAttribute("href","/admin/stock-reviews?history=archived#stock-review-results");
  });
  it("archives one no-change result through the server and refreshes", async () => {
    render(<Results />);
    fireEvent.click(screen.getByRole("button",{name:"Archive"}));
    await waitFor(() => expect(change).toHaveBeenCalledWith({id:"quiet",kind:"report",action:"archive"}));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
  it("requires confirmation before deleting and can cancel without a write", async () => {
    render(<Results />);
    fireEvent.click(screen.getByRole("button",{name:"Delete"}));
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Cancel"}));
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Delete"}));
    fireEvent.click(screen.getByRole("button",{name:"Confirm delete"}));
    await waitFor(() => expect(change).toHaveBeenCalledWith({id:"quiet",kind:"report",action:"delete"}));
  });
  it("restores archived results and does not show unrelated active cards", async () => {
    render(<Results view="archived" />);
    expect(screen.getByText("applied")).toBeInTheDocument();
    expect(screen.queryByText("quiet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Restore"}));
    await waitFor(() => expect(change).toHaveBeenCalledWith({id:"applied",kind:"report",action:"restore"}));
  });
  it("keeps failed changes visible with an error", async () => {
    change.mockResolvedValue({error:"Could not update result."});
    render(<Results />);
    fireEvent.click(screen.getByRole("button",{name:"Archive"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not update result.");
    expect(screen.getByText("quiet")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
