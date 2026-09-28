import { z } from "zod";
import { assertAccountsPreview, ACCOUNTS_PREVIEW_START } from "./accounts-preview";
import type { RuntimeEnv } from "@/lib/runtime-env";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const date=new Date(`${value}T00:00:00.000Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===value; });
const line = z.object({
  id:digest, revision:digest, category:z.enum(["CURSOR","VERCEL_HOSTING","DATABASE","OTHER"]), label:z.string().min(1).max(120),
  periodStart:day, periodEnd:day, amountMinor:z.number().int().safe().nullable(), currency:z.literal("GBP"), provisional:z.literal(true), held:z.boolean(),
  funding:z.string().max(100), events:z.number().int().nonnegative(), sourceCurrency:z.string().max(10), sourceUnits:z.string().regex(/^-?\d+$/).nullable(),
  fx:z.array(z.object({currency:z.string(),date:day,rate:z.string().regex(/^\d+(\.\d+)?$/),source:z.string()}).strict()),
}).strict();
export const accountsSnapshotSchema = z.object({
  version:z.literal("mpdee-project-cost-snapshot-v2"), project:z.literal("itrader"), approvedSnapshot:z.literal(false),
  asOf:z.string().datetime(), revision:digest, sourceUpdatedAt:z.string().datetime().nullable(),
  coverage:z.object({events:z.number().int().nonnegative().max(50000),held:z.number().int().nonnegative(),fxMissing:z.number().int().nonnegative(),from:z.literal(ACCOUNTS_PREVIEW_START)}).strict(),
  lines:z.array(line).max(50000),
}).strict().superRefine((value,ctx)=>{
  if (new Set(value.lines.map(item=>item.id)).size!==value.lines.length) ctx.addIssue({code:"custom",message:"Duplicate snapshot line."});
  if (value.lines.reduce((total,item)=>total+item.events,0)!==value.coverage.events) ctx.addIssue({code:"custom",message:"Incomplete snapshot."});
  if (value.lines.some(item=>item.periodEnd<item.periodStart || item.held && item.amountMinor!==null || item.amountMinor!==null && item.sourceUnits===null)) ctx.addIssue({code:"custom",message:"Invalid snapshot amount or period."});
  if (Date.parse(value.asOf)>Date.now()+300000 || value.sourceUpdatedAt && Date.parse(value.sourceUpdatedAt)>Date.parse(value.asOf)) ctx.addIssue({code:"custom",message:"Invalid snapshot timestamp."});
});
export type AccountsSnapshot = z.infer<typeof accountsSnapshotSchema>;

export const accountsBaselineSchema=z.object({version:z.literal("reviewed-legacy-baseline-v1"),project:z.literal("itrader"),revision:digest,periodEndExclusive:z.literal(true),currency:z.literal("GBP"),accountingTreatment:z.literal("frozen-client-charges-not-provider-cash"),lines:z.array(z.object({id:digest,category:z.enum(["VERCEL_HOSTING","DATABASE","SHARED_VERCEL","OTHER"]),label:z.string().min(1).max(200),periodStart:z.string().datetime(),periodEnd:z.string().datetime(),amountMinor:z.number().int().safe(),currency:z.literal("GBP"),invoiceability:z.enum(["INVOICEABLE","PROVISIONAL"])}).strict()).max(50000)}).strict().superRefine((value,ctx)=>{
  if(new Set(value.lines.map(item=>item.id)).size!==value.lines.length || value.lines.some(item=>item.periodEnd<=item.periodStart))ctx.addIssue({code:"custom",message:"Invalid baseline identity or period."});
});
export type AccountsBaseline=z.infer<typeof accountsBaselineSchema>;
export async function fetchAccountsBaseline(env:RuntimeEnv=process.env):Promise<AccountsBaseline>{
  assertAccountsPreview(env);
  const token=env.COST_ACCOUNTS_READ_TOKEN?.trim();
  if(!token||token.length<32)throw new Error("Accounts project read access is not configured.");
  try{
    const response=await fetch("https://accounts.mpdee.info/api/costs/projects/itrader/baseline",{headers:{authorization:`Bearer ${token}`},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error();
    const text=await response.text();
    if(Buffer.byteLength(text)>15_000_000)throw new Error();
    return accountsBaselineSchema.parse(JSON.parse(text));
  }catch{throw new Error("The reviewed Accounts baseline is unavailable. No local balances were replaced.");}
}

export async function fetchAccountsSnapshot(env:RuntimeEnv=process.env):Promise<AccountsSnapshot> {
  assertAccountsPreview(env);
  const token=env.COST_ACCOUNTS_READ_TOKEN?.trim();
  if (!token || token.length<32) throw new Error("Accounts project read access is not configured.");
  const url=new URL("https://accounts.mpdee.info/api/costs/projects/itrader/snapshot");
  url.searchParams.set("from",ACCOUNTS_PREVIEW_START);
  try {
    const response=await fetch(url,{headers:{authorization:`Bearer ${token}`},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error();
    const text=await response.text();
    if (Buffer.byteLength(text)>15_000_000) throw new Error();
    return accountsSnapshotSchema.parse(JSON.parse(text));
  } catch { throw new Error("The Accounts project snapshot is unavailable or incomplete. No local balances were replaced."); }
}
