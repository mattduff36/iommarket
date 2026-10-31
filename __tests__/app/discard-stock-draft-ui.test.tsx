// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
const {discard,push} = vi.hoisted(() => ({discard:vi.fn(),push:vi.fn()}));
vi.mock("@/actions/stock-drafts",()=>({discardReceivedStockDraft:discard}));
vi.mock("next/navigation",()=>({useRouter:()=>({push,refresh:vi.fn()})}));
import {DiscardStockDraft} from "@/app/(public)/sell/discard-stock-draft";
describe("received draft deletion",()=>{
  it("requires confirmation and sends the exact receipt and lifecycle fence",async()=>{
    discard.mockResolvedValue({data:{listingId:"listing",revisionOnly:true}});
    render(<DiscardStockDraft receiptId="receipt" lifecycleRevision={4}/>);
    fireEvent.click(screen.getByRole("button",{name:"Delete received draft"}));
    expect(discard).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("Any existing live listing stays unchanged");
    fireEvent.click(screen.getByRole("button",{name:"Delete draft"}));
    await waitFor(()=>expect(discard).toHaveBeenCalledWith({receiptId:"receipt",expectedLifecycleRevision:4}));
    await waitFor(()=>expect(push).toHaveBeenCalledWith("/dealer/listings?status=DRAFT"));
  });
});
