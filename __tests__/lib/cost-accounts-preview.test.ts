import { describe,it,expect,vi } from 'vitest';
import type { Prisma } from '@prisma/client';
vi.mock('@/lib/costs/db',()=>({costDb:{}}));
import { assertAccountsPreview,previewDatabaseFingerprint,ACCOUNTS_PREVIEW_START } from '@/lib/costs/accounts-preview';
import { accountsSnapshotSchema,accountsBaselineSchema,type AccountsSnapshot } from '@/lib/costs/accounts-snapshot';
import { projectAccountsSnapshot } from '@/lib/costs/accounts-projection';

const hash='a'.repeat(64);
function snapshot():AccountsSnapshot{return {version:'mpdee-project-cost-snapshot-v2',project:'itrader',approvedSnapshot:false,asOf:'2026-09-20T00:00:00.000Z',revision:hash,sourceUpdatedAt:null,coverage:{events:1,held:0,fxMissing:0,from:ACCOUNTS_PREVIEW_START},lines:[{id:hash,revision:hash,category:'CURSOR',label:'Cursor',periodStart:'2026-09-01',periodEnd:'2026-09-01',amountMinor:123,currency:'GBP',provisional:true,held:false,funding:'included',events:1,sourceCurrency:'USD',sourceUnits:'12300000',fx:[]}]};}

describe('Accounts isolated preview boundary',()=>{
 it('rejects production, a different project, and a different database despite a matching environment pin',()=>{
  const raw='postgres://fixture:private@db.invalid:5432/example';
  const env={COST_LEDGER_ROLE:'accounts-preview',VERCEL_ENV:'production',VERCEL_PROJECT_ID:'prj_TFAfJkG9P0osjQpsH2gaNrSPWbCr',POSTGRES_URL:raw,COST_ACCOUNTS_PREVIEW_DB_FINGERPRINT:previewDatabaseFingerprint(raw)};
  expect(()=>assertAccountsPreview(env)).toThrow();
  expect(()=>assertAccountsPreview({...env,VERCEL_ENV:'preview'})).toThrow();
  expect(()=>assertAccountsPreview({...env,VERCEL_ENV:'preview',VERCEL_PROJECT_ID:'other'})).toThrow();
 });
 it('uses full identity fingerprints without password/query material',()=>{
  expect(previewDatabaseFingerprint('postgres://user:one@db.invalid:5432/name?a=1')).toBe(previewDatabaseFingerprint('postgres://user:two@db.invalid:5432/name?a=2'));
  expect(previewDatabaseFingerprint('postgres://user:one@db.invalid:5432/name')).toHaveLength(64);
 });
 it('rejects malformed dates, held money, duplicate ids and another project',()=>{
  const data=snapshot();expect(accountsSnapshotSchema.safeParse(data).success).toBe(true);
  expect(accountsSnapshotSchema.safeParse({...data,project:'other'}).success).toBe(false);
  expect(accountsSnapshotSchema.safeParse({...data,lines:[{...data.lines[0],periodStart:'2026-99-99'}]}).success).toBe(false);
  expect(accountsSnapshotSchema.safeParse({...data,lines:[{...data.lines[0],held:true}]}).success).toBe(false);
  expect(accountsSnapshotSchema.safeParse({...data,lines:[...data.lines,...data.lines]}).success).toBe(false);
 });
});

function fixture(){
 type SourceRow={id:string;sourceKind:string;bucketKey:string;revision:number;[key:string]:unknown};
 type EntryInput={sourceSnapshotId:string;kind:string;markedGbpMinor:bigint;servicePeriodStart:Date;[key:string]:unknown};
 type EntryRow=EntryInput & {id:string};
 type SourceInput=Omit<SourceRow,'id'>;
 const sources:SourceRow[]=[],entries:EntryRow[]=[];
 const costSourceSnapshot={findMany:vi.fn(async({where}:{where:{sourceKind:string;bucketKey:{startsWith:string}}})=>sources.filter(row=>row.sourceKind===where.sourceKind&&row.bucketKey.startsWith(where.bucketKey.startsWith)).sort((a,b)=>b.revision-a.revision).map(row=>({...row,entries:entries.filter(entry=>entry.sourceSnapshotId===row.id&&entry.kind==='CHARGE')}))),create:vi.fn(async({data}: {data:SourceInput})=>{const row={id:`s${sources.length}`,...data} as SourceRow;sources.push(row);return row;}),createMany:vi.fn(async({data}:{data:SourceInput[]})=>{sources.push(...data.map((row,index)=>({id:`s${sources.length+index}`,...row} as SourceRow)));})};
 const costEntry={create:vi.fn(async({data}:{data:EntryInput})=>{const row={id:`e${entries.length}`,...data};entries.push(row);return row;}),createMany:vi.fn(async({data}:{data:EntryInput[]})=>{entries.push(...data.map((row,index)=>({id:`e${entries.length+index}`,...row})));})};
 const tx={costSourceSnapshot,costEntry,siteSetting:{upsert:vi.fn()}};
 return {sources,entries,tx:tx as unknown as Prisma.TransactionClient};
}
describe('Accounts append-only projection',()=>{
 it('replays without duplication and reverses disappeared or held ids without changing frozen entries',async()=>{
  const f=fixture(),data=snapshot();
  await projectAccountsSnapshot(f.tx,data);await projectAccountsSnapshot(f.tx,data);
  expect(f.entries).toHaveLength(1);expect(f.entries[0].markedGbpMinor).toBe(123n);
  await projectAccountsSnapshot(f.tx,{...data,lines:[{...data.lines[0],id:'b'.repeat(64),revision:'b'.repeat(64),held:true,amountMinor:null}]});
  expect(f.entries).toHaveLength(2);expect(f.entries[1].markedGbpMinor).toBe(-123n);
  expect(f.entries[1].reversesEntryId).toBe(f.entries[0].id);
  expect(f.entries[0].markedGbpMinor).toBe(123n);
 });
 it('preserves baseline credits and exact periods independently of usage and manual entries',async()=>{
  const f=fixture();
  const baseline=accountsBaselineSchema.parse({version:'reviewed-legacy-baseline-v1',project:'itrader',revision:hash,periodEndExclusive:true,currency:'GBP',accountingTreatment:'frozen-client-charges-not-provider-cash',lines:[{id:'c'.repeat(64),category:'OTHER',label:'Credit',periodStart:ACCOUNTS_PREVIEW_START,periodEnd:'2026-08-14T23:00:00.000Z',amountMinor:-9000,currency:'GBP',invoiceability:'INVOICEABLE'}]});
  await projectAccountsSnapshot(f.tx,snapshot(),baseline);await projectAccountsSnapshot(f.tx,snapshot(),baseline);
  expect(f.entries).toHaveLength(2);expect(f.entries[1].markedGbpMinor).toBe(-9000n);
  expect(f.entries[1].servicePeriodStart.toISOString()).toBe(ACCOUNTS_PREVIEW_START);
  expect(f.sources[1].bucketKey).toContain(':baseline:');
 });
});
