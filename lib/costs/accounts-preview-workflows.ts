import { randomUUID, createHash } from "node:crypto";
import { costDb } from "./db";
import { runSerializable } from "./transaction";
import { syncAccountsPreview, PREVIEW_ENTRY_WHERE, PREVIEW_REQUEST_WHERE, jsonValue } from "./accounts-projection";
import { assertAccountsPreview, ACCOUNTS_PREVIEW_PREFIX, ACCOUNTS_PREVIEW_CATEGORIES, ACCOUNTS_PREVIEW_START } from "./accounts-preview";
import { listManualCostCategories, createManualCostCategory } from "./manual-categories";
import { getOrCreateIdentityGbpRate, getOrCreateUsdGbpRate } from "./fx";
import { computeUnmarkedGbpMinor, minorToSafeNumber } from "./money";
import { recordManualCostSchema, type RecordManualCostInput } from "@/lib/validations/costs";

const openSlot=`${ACCOUNTS_PREVIEW_PREFIX}open`;
const eventType="ACCOUNTS_PREVIEW_REQUESTED";
export async function createPreviewInvoiceRequest(actorId:string){
  assertAccountsPreview();
  await syncAccountsPreview();
  return runSerializable(async tx=>{
    assertAccountsPreview();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(727402)`;
    if(await tx.invoiceRequest.findUnique({where:{openSlot}}))throw new Error("An invoice request is already pending.");
    const entries=await tx.costEntry.findMany({where:{...PREVIEW_ENTRY_WHERE,invoiceability:"INVOICEABLE",settlement:{is:null},invoiceLines:{none:{request:{status:"PENDING"}}}},orderBy:{id:"asc"}});
    const amount=entries.reduce((total,row)=>total+row.markedGbpMinor,0n);
    minorToSafeNumber(amount);
    if(amount<=0n)throw new Error("There is no invoiceable preview balance to request.");
    const request=await tx.invoiceRequest.create({data:{status:"PENDING",openSlot,requesterUserId:actorId,frozenGbpMinor:amount,frozenEntryCount:entries.length}});
    await tx.invoiceRequestLine.createMany({data:entries.map(row=>({invoiceRequestId:request.id,costEntryId:row.id,markedGbpMinor:row.markedGbpMinor}))});
    await tx.costWorkflowEvent.create({data:{invoiceRequestId:request.id,type:eventType,actorUserId:actorId,payload:{sandbox:true,approvedSnapshot:false,notForProduction:true}}});
    await tx.costEmailOutbox.create({data:{invoiceRequestId:request.id,kind:eventType,status:"SUPPRESSED",lastError:"Preview simulation: no email is sent.",nextAttemptAt:null}});
    return {requestId:request.id};
  });
}

export async function findPreviewInvoiceRequest(requestId:string){
  assertAccountsPreview();
  return costDb.invoiceRequest.findFirst({where:{id:requestId,...PREVIEW_REQUEST_WHERE}});
}

export async function confirmPreviewInvoiceRequest(requestId:string,actorId:string){
  assertAccountsPreview();
  return runSerializable(async tx=>{
    assertAccountsPreview();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(727402)`;
    const request=await tx.invoiceRequest.findFirst({where:{id:requestId,...PREVIEW_REQUEST_WHERE},include:{lines:{include:{entry:{include:{sourceSnapshot:true}}}}}});
    if(!request)throw new Error("Preview request was not found.");
    if(request.status==="CONFIRMED")return {requestId,alreadyConfirmed:true};
    if(request.status!=="PENDING")throw new Error("Only a pending request can be confirmed.");
    if(request.lines.some(line=>line.entry.sourceKind!=="ACCOUNTS_LEDGER"||!line.entry.sourceSnapshot.bucketKey.startsWith(ACCOUNTS_PREVIEW_PREFIX)))throw new Error("Preview request scope could not be verified.");
    await tx.costSettlement.createMany({data:request.lines.map(line=>({costEntryId:line.costEntryId,invoiceRequestId:request.id,markedGbpMinor:line.markedGbpMinor}))});
    await tx.invoiceRequest.update({where:{id:request.id},data:{status:"CONFIRMED",openSlot:null,confirmerUserId:actorId,confirmedAt:new Date()}});
    await tx.costWorkflowEvent.create({data:{invoiceRequestId:request.id,type:"ACCOUNTS_PREVIEW_CONFIRMED",actorUserId:actorId,payload:{sandbox:true,notForProduction:true}}});
    return {requestId,alreadyConfirmed:false};
  });
}

export async function recordPreviewManualCost(input:RecordManualCostInput,actorId:string){
  assertAccountsPreview();
  const parsed=recordManualCostSchema.parse(input);
  const category=(await listManualCostCategories(ACCOUNTS_PREVIEW_CATEGORIES)).find(item=>item.slug===parsed.categorySlug);
  if(!category)throw new Error("Choose a cost category.");
  if(Date.parse(parsed.periodStart)<Date.parse(ACCOUNTS_PREVIEW_START))throw new Error("The preview cost period precedes the ledger start.");
  await runSerializable(async tx=>{
    assertAccountsPreview();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(727402)`;
    const date=new Date(parsed.periodStart);
    const fx=parsed.nativeCurrency==="GBP"?await getOrCreateIdentityGbpRate(tx,date):await getOrCreateUsdGbpRate(tx,date);
    const amount=computeUnmarkedGbpMinor(parsed.nativeAmount,fx.rate);minorToSafeNumber(amount);
    const key=`${ACCOUNTS_PREVIEW_PREFIX}manual:${randomUUID()}`;
    const source=await tx.costSourceSnapshot.create({data:{sourceKind:"ACCOUNTS_LEDGER",bucketKey:key,revision:1,checksum:createHash("sha256").update(key).digest("hex"),periodStart:date,periodEnd:new Date(parsed.periodEnd),classified:true,metadata:jsonValue({sandbox:true,notForProduction:true,manualCategorySlug:category.slug,manualCategoryLabel:category.label,actorId})}});
    await tx.costEntry.create({data:{sourceKind:"ACCOUNTS_LEDGER",sourceSnapshotId:source.id,category:"OTHER",kind:"CHARGE",invoiceability:"INVOICEABLE",nativeAmount:parsed.nativeAmount,nativeCurrency:parsed.nativeCurrency,markedGbpMinor:amount,fxRateSnapshotId:fx.id,servicePeriodStart:date,servicePeriodEnd:new Date(parsed.periodEnd),displayLabel:parsed.displayLabel}});
  });
}

export async function addPreviewManualCategory(label:string){assertAccountsPreview();return createManualCostCategory(label,ACCOUNTS_PREVIEW_CATEGORIES);}

export async function suppressPreviewEmail(outboxId:string){
  assertAccountsPreview();
  const row=await costDb.costEmailOutbox.findFirst({where:{id:outboxId,kind:eventType,request:PREVIEW_REQUEST_WHERE}});
  if(!row)throw new Error("Preview notification was not found.");
  await costDb.costEmailOutbox.update({where:{id:row.id},data:{status:"SUPPRESSED",lastError:"Preview simulation: no email is sent.",nextAttemptAt:null}});
}
