// @vitest-environment jsdom
import { useRef } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StockWorkerPageLock } from "@/app/(admin)/admin/stock-reviews/worker-page-lock";
import type { LiveStockJob } from "@/app/(admin)/admin/stock-reviews/worker-dashboard";
vi.mock("@/app/(admin)/admin/stock-reviews/stock-updater-logo", () => ({StockUpdaterLogo: () => <span>iTrader</span>}));

function Fixture({ active = true, jobs = [], click = vi.fn() }: { active?: boolean; jobs?: LiveStockJob[]; click?: () => void }) {
  const footer = useRef<HTMLElement>(null);
  return <>
    <section data-testid="results"><button onClick={click}>Edit result</button></section>
    <footer ref={footer}><button onClick={click}>Stop safely</button></footer>
    {active && <StockWorkerPageLock footer={footer} jobs={jobs} badge="Oracle Connected" status="Request in progress" />}
  </>;
}

afterEach(cleanup);
describe("live stock queue", () => {
  it("isolates the background immediately, retains footer actions and restores interaction", () => {
    const click = vi.fn();
    const view = render(<Fixture click={click}/>);
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(screen.getByTestId("results")).toHaveAttribute("inert");
    expect(screen.getByText("Request in progress")).toBeVisible();
    fireEvent.click(screen.getByText("Edit result"));
    expect(click).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Stop safely"));
    expect(click).toHaveBeenCalledTimes(1);
    view.rerender(<Fixture click={click} active={false}/>);
    expect(document.documentElement.style.overflow).not.toBe("hidden");
    expect(screen.getByTestId("results")).not.toHaveAttribute("inert");
    expect(screen.queryByText("Dealer queue")).toBeNull();
    fireEvent.click(screen.getByText("Edit result"));
    expect(click).toHaveBeenCalledTimes(2);
  });
  it("renders real mixed scrape and apply outcomes without guessing pending results", () => {
    const jobs = ["QUEUED","LEASED","SUCCEEDED","FAILED","CANCELLED"].map((status,i) => ({
      id:String(i),dealerName:"Dealer "+i,status,kind:i===1?"APPLY":"SCRAPE",startedAt:null,reportStatus:"PENDING_REVIEW",reviewListingCount:3
    }));
    render(<Fixture jobs={jobs}/>);
    const queue=within(screen.getByRole("region",{name:"Live dealer queue"}));
    expect(queue.getByRole("status")).toHaveTextContent("3 of 5 complete");
    const rows=queue.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Waiting for worker");
    expect(rows[1]).toHaveTextContent("Applying approved changes");
    expect(rows[2]).toHaveTextContent("3 listings for review");
    expect(rows[3]).toHaveTextContent("task failed");
    expect(rows[4]).toHaveTextContent("task cancelled");
  });
});
