import { beforeEach, expect, it, vi } from "vitest";
const { findMany } = vi.hoisted(() => ({findMany:vi.fn()}));
vi.mock("@/lib/db",()=>({db:{dealerStockSyncAudit:{findMany}}}));
import { loadResultHistory } from "@/lib/dealer-stock-sync/result-history-store";
beforeEach(()=>findMany.mockResolvedValue([]));
it("loads saved history across sessions and retains no-change results",async()=>{
  findMany.mockResolvedValue([{reportId:"quiet",jobId:null,action:"RESULT_DELETED"},{reportId:null,jobId:"old-job",action:"RESULT_ARCHIVED"}]);
  const rows=await loadResultHistory([
    {id:"applied",status:"APPLIED",plan:{actions:[]},scrapeRunId:"scan"},
    {id:"quiet",status:"PENDING_REVIEW",plan:{actions:[{kind:"unchanged",sourceIdentityKey:"sourceVehicleId:same",listingId:null}]},scrapeRunId:"quiet-scan"},
    {id:"older",status:"SUPERSEDED",plan:{actions:[{kind:"unchanged",sourceIdentityKey:"sourceVehicleId:same",listingId:null}]},scrapeRunId:"older-scan"},
  ],[{id:"old-job",status:"SUCCEEDED",reportId:null}]);
  expect(rows).toEqual([
    {id:"applied",kind:"report",state:"archived",manageable:true},
    {id:"quiet",kind:"report",state:"deleted",manageable:true,restoreState:"archived"},
    {id:"older",kind:"report",state:"archived",manageable:true,restoreState:"archived"},
    {id:"old-job",kind:"job",state:"archived",manageable:true},
  ]);
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({distinct:["reportId","jobId"],orderBy:[{createdAt:"desc"},{id:"desc"}]}));
});
it("derives automatic archive state after restore without a persisted archive event", async () => {
  findMany.mockResolvedValue([{ reportId: "quiet", jobId: null, action: "RESULT_RESTORED" }]);
  const rows = await loadResultHistory([{ id: "quiet", status: "PENDING_REVIEW", plan: { actions: [] }, scrapeRunId: "scan" }], []);
  expect(rows).toEqual([{ id: "quiet", kind: "report", state: "archived", manageable: true, restoreState: "archived" }]);
});
it("never hides active work even if it has an old history event",async()=>{
  findMany.mockResolvedValue([{reportId:"approved",jobId:null,action:"RESULT_DELETED"},{reportId:null,jobId:"running",action:"RESULT_ARCHIVED"}]);
  const rows=await loadResultHistory([
    {id:"approved",status:"APPROVED",plan:{actions:[]},scrapeRunId:"scan"},
    {id:"finished",status:"APPLIED",plan:{actions:[]},scrapeRunId:"running"},
  ],[{id:"running",status:"LEASED",reportId:"finished"}]);
  expect(rows.every(row=>row.state==="active"&&!row.manageable)).toBe(true);
});

it("archives completed apply jobs even when their report is outside the recent report window", async () => {
  const rows = await loadResultHistory([], [{id:"apply",status:"SUCCEEDED",reportId:"older-report",report:{status:"APPLIED"}}]);
  expect(rows[0]).toMatchObject({state:"archived",manageable:true});
});
