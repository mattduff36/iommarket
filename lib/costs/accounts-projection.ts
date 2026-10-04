import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { costDb } from "./db";
import { fetchAccountsSnapshot, fetchAccountsBaseline, type AccountsSnapshot, type AccountsBaseline } from "./accounts-snapshot";
import { assertAccountsPreview, ACCOUNTS_PREVIEW_PREFIX, ACCOUNTS_PREVIEW_SETTINGS, ACCOUNTS_PREVIEW_START } from "./accounts-preview";

export const PREVIEW_ENTRY_WHERE = { sourceKind:"ACCOUNTS_LEDGER" as const, sourceSnapshot:{bucketKey:{startsWith:ACCOUNTS_PREVIEW_PREFIX}} };
export const PREVIEW_REQUEST_WHERE = { events:{some:{type:"ACCOUNTS_PREVIEW_REQUESTED"}} };
export const jsonValue=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const penceDecimal=(value:bigint)=>`${value<0n?"-":""}${(value<0n?-value:value)/100n}.${((value<0n?-value:value)%100n).toString().padStart(2,"0")}`;
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const projectionPrefix=`${ACCOUNTS_PREVIEW_PREFIX}line:`;

/** Replace a complete scoped source view by appending changes, never rewriting frozen entries. */
export async function projectAccountsSnapshot(tx:Prisma.TransactionClient,snapshot:AccountsSnapshot,baseline?:AccountsBaseline,options?:{reviewedInfrastructureDeltaIds?:readonly string[]}){
  await projectLines(tx,snapshot.lines,snapshot.revision,projectionPrefix);
  if(baseline){
    const nonCursor=snapshot.lines.filter(line=>line.category!=="CURSOR");
    if(nonCursor.length){
      // Infrastructure joins the preview only when every non-Cursor line was named and none reuse a frozen baseline id.
      const reviewed=options?.reviewedInfrastructureDeltaIds;
      const allowed=new Set(reviewed??[]);
      if(!reviewed||nonCursor.some(line=>!allowed.has(line.id)))throw new Error("Infrastructure overlap requires a reviewed cutover.");
      const baselineIds=new Set(baseline.lines.map(line=>line.id));
      if(nonCursor.some(line=>baselineIds.has(line.id)))throw new Error("Infrastructure delta overlaps the frozen baseline.");
    }
    await projectLines(tx,baseline.lines.map(line=>({...line,revision:digest(line),held:false})),baseline.revision,`${ACCOUNTS_PREVIEW_PREFIX}baseline:`,true);
  }
  const combined={...snapshot,revision:baseline?digest([snapshot.revision,baseline.revision]):snapshot.revision};
  await tx.siteSetting.upsert({where:{key:ACCOUNTS_PREVIEW_SETTINGS},create:{key:ACCOUNTS_PREVIEW_SETTINGS,value:jsonValue(combined)},update:{value:jsonValue(combined)}});
  return combined;
}

type ProjectionLine={id:string;revision:string;category:AccountsSnapshot['lines'][number]['category']|"SHARED_VERCEL";label:string;periodStart:string;periodEnd:string;amountMinor:number|null;held:boolean;invoiceability?:"INVOICEABLE"|"PROVISIONAL"};
async function projectLines(tx:Prisma.TransactionClient,lines:ProjectionLine[],revision:string,prefix:string,exactPeriods=false){
  const old=await tx.costSourceSnapshot.findMany({where:{sourceKind:"ACCOUNTS_LEDGER",bucketKey:{startsWith:prefix}},orderBy:{revision:"desc"},include:{entries:{where:{kind:"CHARGE"}}}});
  const latest=new Map<string,(typeof old)[number]>();
  for(const row of old)if(!latest.has(row.bucketKey))latest.set(row.bucketKey,row);
  const next=new Map(lines.map(line=>[`${prefix}${line.id}`,line]));
  const keys=new Set([...latest.keys(),...next.keys()]);
  const sources:Prisma.CostSourceSnapshotCreateManyInput[]=[];
  const entries:Prisma.CostEntryCreateManyInput[]=[];
  for(const key of keys){
    const previous=latest.get(key),line=next.get(key);
    const checksum=line?.revision??digest([key,"retired"]);
    if(previous?.checksum===checksum)continue;
    const former=previous?.entries[0];
    const periodStart=line?(exactPeriods?new Date(line.periodStart):new Date(Math.max(Date.parse(`${line.periodStart}T00:00:00.000Z`),Date.parse(ACCOUNTS_PREVIEW_START)))):previous!.periodStart;
    const periodEnd=line?(exactPeriods?new Date(line.periodEnd):new Date(Date.parse(`${line.periodEnd}T00:00:00.000Z`)+86400000)):previous!.periodEnd;
    const source={id:randomUUID()};
    sources.push({id:source.id,sourceKind:"ACCOUNTS_LEDGER",bucketKey:key,revision:(previous?.revision??0)+1,checksum,periodStart,periodEnd,classified:true,quarantined:false,metadata:jsonValue({sandbox:true,approvedSnapshot:false,accountsRevision:revision,line:line??null,retired:!line,frozenLegacyCharge:exactPeriods})});
    if(former)entries.push({id:randomUUID(),sourceKind:"ACCOUNTS_LEDGER",sourceSnapshotId:source.id,category:former.category,kind:"REVERSAL",invoiceability:former.invoiceability,reversesEntryId:former.id,fxRateSnapshotId:former.fxRateSnapshotId,nativeAmount:former.nativeAmount,nativeCurrency:former.nativeCurrency,markedGbpMinor:-former.markedGbpMinor,servicePeriodStart:periodStart,servicePeriodEnd:periodEnd,displayLabel:former.displayLabel});
    // Unknown/held amounts remain evidence; they are never invented as zero charges.
    // Provisional, unknown and unapproved amounts stay non-invoiceable. Baseline rows keep their own invoiceability.
    if(line&&!line.held&&line.amountMinor!==null)entries.push({id:randomUUID(),sourceKind:"ACCOUNTS_LEDGER",sourceSnapshotId:source.id,category:line.category,kind:"CHARGE",invoiceability:line.invoiceability??"PROVISIONAL",nativeAmount:penceDecimal(BigInt(line.amountMinor)),nativeCurrency:"GBP",markedGbpMinor:BigInt(line.amountMinor),servicePeriodStart:periodStart,servicePeriodEnd:periodEnd,displayLabel:line.label});
  }
  for(let offset=0;offset<sources.length;offset+=500)await tx.costSourceSnapshot.createMany({data:sources.slice(offset,offset+500)});
  for(let offset=0;offset<entries.length;offset+=500)await tx.costEntry.createMany({data:entries.slice(offset,offset+500)});
}

export async function syncAccountsPreview(){
  assertAccountsPreview();
  const [snapshot,baseline]=await Promise.all([fetchAccountsSnapshot(),fetchAccountsBaseline()]);
  assertAccountsPreview();
  return costDb.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(727402)`;
    const prior=await tx.siteSetting.findUnique({where:{key:ACCOUNTS_PREVIEW_SETTINGS}});
    const priorAsOf=prior?.value&&typeof prior.value==="object"&&!Array.isArray(prior.value)?prior.value.asOf:null;
    if(typeof priorAsOf==="string"&&Date.parse(priorAsOf)>Date.parse(snapshot.asOf))return prior!.value as unknown as AccountsSnapshot;
    return projectAccountsSnapshot(tx,snapshot,baseline);
  },{isolationLevel:"Serializable",timeout:30000});
}
