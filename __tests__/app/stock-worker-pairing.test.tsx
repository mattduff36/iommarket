// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { auth, allowed, invitation, approve, redirect, headers } = vi.hoisted(() => ({auth:vi.fn(),allowed:vi.fn(),invitation:vi.fn(),approve:vi.fn(),redirect:vi.fn(),headers:vi.fn()}));
vi.mock("@/lib/auth",()=>({requireRole:auth}));
vi.mock("next/headers",()=>({headers}));
vi.mock("next/navigation",()=>({redirect}));
vi.mock("@/lib/dealer-stock-sync/desktop-config",()=>({desktopAccountEnabled:allowed}));
vi.mock("@/lib/dealer-stock-sync/desktop-service",()=>({liveDesktopDependencies:()=>({}),readDesktopInvitation:invitation,approveDesktopDevice:approve}));
import { StockWorkerPairing, authoriseStockComputer } from "@/app/(admin)/admin/stock-reviews/worker-pairing";
beforeEach(()=>{vi.clearAllMocks();auth.mockResolvedValue({id:"admin"});allowed.mockReturnValue(true);invitation.mockResolvedValue({deviceName:"MPDEE-SERVER",environment:"preview"});headers.mockResolvedValue(new Headers({origin:"https://itrader.dev",host:"itrader.dev"}));approve.mockResolvedValue({ok:true});});
describe("Stock Reviews pairing",()=>{
 it("requires explicit approval and displays named computer and environment",async()=>{
  render(await StockWorkerPairing({code:"ABCD1234",status:""}));
  expect(screen.getByRole("button",{name:"Authorise this computer"})).toBeInTheDocument();
  expect(screen.getByText("MPDEE-SERVER")).toBeInTheDocument();
  expect(approve).not.toHaveBeenCalled();
 });
 it("does not expose an invitation for a disallowed admin",async()=>{
  allowed.mockReturnValue(false);
  render(await StockWorkerPairing({code:"ABCD1234",status:""}));
  expect(invitation).not.toHaveBeenCalled();
  expect(screen.queryByRole("button",{name:"Authorise this computer"})).toBeNull();
 });
 it("passes current admin and origin through the existing secure approval service",async()=>{
  const form=new FormData();form.set("userCode","ABCD1234");
  await authoriseStockComputer(form);
  expect(approve).toHaveBeenCalledWith({}, {adminId:"admin",userCode:"ABCD1234",origin:"https://itrader.dev",host:"itrader.dev",forwardedHost:null});
  expect(redirect).toHaveBeenCalledWith("/admin/stock-reviews?status=authorised");
 });
});
