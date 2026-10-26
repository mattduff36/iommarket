import { beforeEach, describe, expect, it, vi } from "vitest";
const { db, auth, rate, refresh } = vi.hoisted(() => ({
  auth: vi.fn(), rate: vi.fn(), refresh: vi.fn(),
  db: {
    $transaction: vi.fn(), $queryRaw: vi.fn(),
    dealerStockSyncReport: {findUnique:vi.fn()},
    dealerStockSyncJob: {findUnique:vi.fn(),findFirst:vi.fn()},
    dealerStockSyncAudit: {findFirst:vi.fn(),create:vi.fn()},
  },
}));
vi.mock("@/lib/db",()=>({db}));
vi.mock("@/lib/auth",()=>({requireRole:auth}));
vi.mock("@/lib/rate-limit",()=>({checkRateLimit:rate}));
vi.mock("next/cache",()=>({revalidatePath:refresh}));
import { changeStockResultHistory } from "@/actions/admin/stock-result-history";
beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({id:"admin"});
  rate.mockResolvedValue({allowed:true});
  db.$transaction.mockImplementation(async fn=>fn(db));
  db.$queryRaw.mockResolvedValue([{id:"result"}]);
  db.dealerStockSyncReport.findUnique.mockResolvedValue({status:"PENDING_REVIEW",plan:{actions:[{kind:"unchanged"}]},scrapeRunId:"scan"});
  db.dealerStockSyncJob.findUnique.mockResolvedValue({status:"SUCCEEDED"});
  db.dealerStockSyncJob.findFirst.mockResolvedValue(null);
  db.dealerStockSyncAudit.findFirst.mockResolvedValue(null);
  db.dealerStockSyncAudit.create.mockResolvedValue({id:"audit"});
});
describe("server result history",()=>{
  it("requires admin before accessing history",async()=>{
    auth.mockRejectedValue(new Error("unauthorized"));
    await expect(changeStockResultHistory({id:"result",kind:"report",action:"archive"})).rejects.toThrow("unauthorized");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("rejects malformed requests and rate limits before DB access",async()=>{
    expect(await changeStockResultHistory({id:"",kind:"report",action:"delete"})).toEqual({error:"Invalid result."});
    rate.mockResolvedValue({allowed:false});
    expect(await changeStockResultHistory({id:"r",kind:"report",action:"archive"})).toEqual({error:expect.stringContaining("Too many")});
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it.each(["archive","delete","restore"] as const)("saves %s as an audit event without modifying the report or listings",async action=>{
    expect(await changeStockResultHistory({id:"result",kind:"report",action})).toEqual({success:true});
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.dealerStockSyncAudit.create).toHaveBeenCalledWith({data:expect.objectContaining({
      reportId:"result",actorId:"admin",action:{archive:"RESULT_ARCHIVED",delete:"RESULT_DELETED",restore:"RESULT_RESTORED"}[action],
    })});
    expect(refresh).toHaveBeenCalledWith("/admin/stock-reviews");
  });
  it.each(["APPROVED","PENDING_REVIEW"])("protects actionable %s work",async status=>{
    db.dealerStockSyncReport.findUnique.mockResolvedValue({status,plan:{actions:[{kind:"update"}]},scrapeRunId:"scan"});
    expect(await changeStockResultHistory({id:"result",kind:"report",action:"delete"})).toEqual({error:expect.stringContaining("Active work")});
    expect(db.dealerStockSyncAudit.create).not.toHaveBeenCalled();
  });
  it("protects a completed report while its linked job is still active",async()=>{
    db.dealerStockSyncJob.findFirst.mockResolvedValue({id:"active"});
    expect(await changeStockResultHistory({id:"result",kind:"report",action:"archive"})).toEqual({error:"This result still has active work."});
    expect(db.dealerStockSyncAudit.create).not.toHaveBeenCalled();
  });
  it("protects active jobs",async()=>{
    db.dealerStockSyncJob.findUnique.mockResolvedValue({status:"LEASED"});
    expect(await changeStockResultHistory({id:"job",kind:"job",action:"delete"})).toEqual({error:expect.stringContaining("Active work")});
    expect(db.dealerStockSyncAudit.create).not.toHaveBeenCalled();
  });
  it("archives an unlinked completed job",async()=>{
    expect(await changeStockResultHistory({id:"job",kind:"job",action:"archive"})).toEqual({success:true});
    expect(db.dealerStockSyncAudit.create).toHaveBeenCalledWith({data:expect.objectContaining({jobId:"job",action:"RESULT_ARCHIVED"})});
  });
  it("returns a safe error on storage failure",async()=>{
    db.dealerStockSyncAudit.create.mockRejectedValueOnce(new Error("secret connection error"));
    expect(await changeStockResultHistory({id:"result",kind:"report",action:"delete"})).toEqual({error:"Could not update this result. Please try again."});
    expect(refresh).not.toHaveBeenCalled();
  });
});
