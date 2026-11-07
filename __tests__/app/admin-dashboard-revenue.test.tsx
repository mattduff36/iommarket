import { isValidElement, type ReactNode, type ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
  const paymentAggregate = vi.fn(); const chargeAggregate = vi.fn();
  const listingCount = vi.fn();
  const paymentCount = vi.fn(async () => 2); const chargeCount = vi.fn(async () => 1);
  const model = () => ({ count: vi.fn(async () => 0), findMany: vi.fn(async () => []), aggregate: vi.fn(async () => ({ _sum: { amount: 0 } })) });
  const db = new Proxy({ listing: { ...model(), count: listingCount }, payment: { ...model(), count: paymentCount, aggregate: paymentAggregate }, subscriptionCharge: { ...model(), count: chargeCount, aggregate: chargeAggregate } }, { get(target, key) { return key in target ? target[key as keyof typeof target] : model(); } });
  return { db, paymentAggregate, chargeAggregate, paymentCount, chargeCount, listingCount };
});
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/auth", () => ({ requireRole: vi.fn(async () => ({})) }));
vi.mock("@/lib/listings/expiry", () => ({ expireStaleLiveListings: vi.fn(), liveListingWhere: () => ({ status: "LIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date("2026-11-04T12:00:00Z") } }] }) }));
vi.mock("@/lib/listings/sample-visibility", async importOriginal => ({ ...await importOriginal<object>(), getSampleVisibility: async () => ({ privateListings: true, dealerListings: true }) }));
vi.mock("@/lib/payments/payment-visibility", () => ({ resolveVisibleAdminPaymentWhere: async () => ({}) }));
vi.mock("@/lib/trade-exchange/flag", () => ({ isTradeExchangeEnabled: () => false }));
import Page from "@/app/(admin)/admin/page";
import { AdminDashboardStats } from "@/components/admin/admin-dashboard-stats";
function findStats(node: ReactNode): ComponentProps<typeof AdminDashboardStats> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) { const found = findStats(child); if (found) return found; }
    return;
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return;
  if (node.type === AdminDashboardStats) return node.props as ComponentProps<typeof AdminDashboardStats>;
  return findStats(node.props.children);
}
beforeEach(() => { vi.clearAllMocks(); mocks.listingCount.mockResolvedValue(0); mocks.paymentAggregate.mockResolvedValue({ _sum: { amount: 1000 } }); mocks.chargeAggregate.mockResolvedValue({ _sum: { amount: 2999 } }); });
describe("dashboard recognised revenue", () => {
  it("includes paid subscription receipts and excludes refunded money through the shared revenue predicates", async () => {
    const page = await Page();
    expect(mocks.paymentAggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ AND: expect.arrayContaining([expect.objectContaining({ status: "SUCCEEDED", refundedAt: null })]) }) }));
    expect(mocks.chargeAggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ refundedAt: null, subscription: { is: expect.objectContaining({ AND: expect.arrayContaining([expect.objectContaining({ dealer: expect.any(Object) })]) }) } }) }));
    expect(findStats(page)!.stats.find((stat: { label: string }) => stat.label === "Revenue")!.value).toBe("\u00a339.99");
    expect(findStats(page)!.stats.find((stat: { label: string }) => stat.label === "Revenue")!.hint).toBe("3 payments (30d)");
    expect(mocks.chargeCount).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ refundedAt: null, eventTimestamp: { gte: expect.any(Date) } }) }));
  });
  it("handles empty payment and subscription ledgers", async () => {
    mocks.paymentAggregate.mockResolvedValue({ _sum: { amount: null } }); mocks.chargeAggregate.mockResolvedValue({ _sum: { amount: null } });
    expect(findStats(await Page())!.stats.find((stat: { label: string }) => stat.label === "Revenue")!.value).toBe("\u00a30");
  });
});

describe("dashboard public listing breakdown", () => {
  it("counts private and dealer listings using public marketplace visibility", async () => {
    mocks.listingCount.mockImplementation(async ({ where }) => {
      if (where.AND?.some((part: { dealerId?: unknown }) => part.dealerId === null)) return 7;
      if (where.AND?.some((part: { dealerId?: { not?: unknown } }) => part.dealerId?.not === null)) return 11;
      return 40; // Other queue/catalog counts must not enter the Live Listings total.
    });
    const page = await Page();
    const stat = findStats(page)!.stats.find((entry) => entry.label === "Public Listings")!;
    expect(stat.value).toBe("18");
    expect(stat.hint).toBe("Private: 7 · Dealer: 11");
    const liveFilter = { status: "LIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date("2026-11-04T12:00:00Z") } }] };
    const publicFilter = expect.objectContaining({ AND: expect.arrayContaining([
      liveFilter,
      expect.objectContaining({
        user: { disabledAt: null, deletedAt: null },
        OR: expect.arrayContaining([
          { dealerId: null },
          { dealer: { is: expect.objectContaining({ AND: expect.arrayContaining([expect.objectContaining({ subscriptions: expect.any(Object), isAdminPreview: false })]) }) } },
        ]),
      }),
    ]) });
    const visibleLiveFilter = expect.objectContaining({ AND: expect.arrayContaining([publicFilter]) });
    expect(mocks.listingCount).toHaveBeenCalledWith({ where: { AND: [visibleLiveFilter, { dealerId: null }] } });
    expect(mocks.listingCount).toHaveBeenCalledWith({ where: { AND: [visibleLiveFilter, { dealerId: { not: null } }] } });
    expect(mocks.listingCount.mock.calls[0][0].where.AND[0]).toEqual(mocks.listingCount.mock.calls[2][0].where.AND[0]);
  });
});
