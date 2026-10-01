import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({guard:vi.fn(),sync:vi.fn(),tx:{ $executeRaw:vi.fn(),invoiceRequest:{findUnique:vi.fn(),findFirst:vi.fn(),create:vi.fn(),update:vi.fn()},costEntry:{findMany:vi.fn()},invoiceRequestLine:{createMany:vi.fn()},costWorkflowEvent:{create:vi.fn()},costEmailOutbox:{create:vi.fn()},costSettlement:{createMany:vi.fn()}}}));
vi.mock('@/lib/costs/accounts-preview',()=>({assertAccountsPreview:mocks.guard,ACCOUNTS_PREVIEW_PREFIX:'accounts-preview:itrader:',ACCOUNTS_PREVIEW_CATEGORIES:'fixture',ACCOUNTS_PREVIEW_START:'2026-08-13T23:00:00.000Z'}));
vi.mock('@/lib/costs/db',()=>({costDb:{}}));
vi.mock('@/lib/costs/transaction',()=>({runSerializable:(fn:(client:typeof mocks.tx)=>unknown)=>fn(mocks.tx)}));
vi.mock('@/lib/costs/accounts-projection',()=>({syncAccountsPreview:mocks.sync,PREVIEW_ENTRY_WHERE:{sourceKind:'ACCOUNTS_LEDGER',sourceSnapshot:{bucketKey:{startsWith:'accounts-preview:itrader:'}}},PREVIEW_REQUEST_WHERE:{events:{some:{type:'ACCOUNTS_PREVIEW_REQUESTED'}}},jsonValue:(value:unknown)=>value}));
import {createPreviewInvoiceRequest,confirmPreviewInvoiceRequest} from '@/lib/costs/accounts-preview-workflows';
describe('isolated request and settlement workflow',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.guard.mockImplementation(()=>{});mocks.tx.invoiceRequest.findUnique.mockResolvedValue(null);mocks.tx.invoiceRequest.create.mockResolvedValue({id:'request'});});
 it('freezes signed pence and captures a suppressed notification without dispatch',async()=>{
  mocks.tx.costEntry.findMany.mockResolvedValue([{id:'one',markedGbpMinor:500n},{id:'credit',markedGbpMinor:-100n}]);
  expect(await createPreviewInvoiceRequest('actor')).toEqual({requestId:'request'});
  expect(mocks.tx.invoiceRequest.create.mock.calls[0][0].data.frozenGbpMinor).toBe(400n);
  expect(mocks.tx.costEntry.findMany.mock.calls[0][0].where.sourceKind).toBe('ACCOUNTS_LEDGER');
  expect(mocks.tx.costEmailOutbox.create.mock.calls[0][0].data.status).toBe('SUPPRESSED');
  expect(mocks.tx.invoiceRequestLine.createMany.mock.calls[0][0].data[1].markedGbpMinor).toBe(-100n);
 });
 it('fails before collection or mutation when deployment guard fails',async()=>{
  mocks.guard.mockImplementation(()=>{throw new Error('wrong environment');});
  await expect(createPreviewInvoiceRequest('actor')).rejects.toThrow('wrong environment');
  expect(mocks.sync).not.toHaveBeenCalled();expect(mocks.tx.invoiceRequest.create).not.toHaveBeenCalled();
 });
 it('refuses settlement of an entry outside the preview namespace',async()=>{
  mocks.tx.invoiceRequest.findFirst.mockResolvedValue({id:'request',status:'PENDING',lines:[{entry:{sourceKind:'CURSOR_USAGE',sourceSnapshot:{bucketKey:'legacy'}}}]});
  await expect(confirmPreviewInvoiceRequest('request','actor')).rejects.toThrow('scope');
  expect(mocks.tx.costSettlement.createMany).not.toHaveBeenCalled();
 });
});
