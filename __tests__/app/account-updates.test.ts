import { beforeEach, describe, expect, it, vi } from "vitest";
const { user, aggregate, entitlement } = vi.hoisted(() => ({ user: vi.fn(), aggregate: vi.fn(), entitlement: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: user }));
vi.mock("@/lib/db", () => ({ db: {
  listing: { aggregate }, dealerUpgradeOffer: { aggregate }, subscription: { aggregate }, user: { aggregate },
} }));
vi.mock("@/lib/dealers/entitlement", () => ({ getCurrentDealerEntitlement: entitlement }));
import { GET } from "@/app/api/account-updates/route";

describe("account update versions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    user.mockResolvedValue({ id: "own-user", role: "USER", updatedAt: "unchanged", dealerProfile: null });
    aggregate.mockResolvedValue({ _count: 1, _max: { updatedAt: "first" } });
    entitlement.mockResolvedValue(null);
  });
  it("rejects unauthenticated and non-admin global access before queries", async () => {
    user.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://example.test/api/account-updates"))).status).toBe(401);
    expect((await GET(new Request("https://example.test/api/account-updates?scope=admin"))).status).toBe(403);
    expect(aggregate).not.toHaveBeenCalled();
  });
  it("scopes member data and returns only an opaque, uncached version", async () => {
    const response = await GET(new Request("https://example.test/api/account-updates"));
    const first = await response.json();
    expect(Object.keys(first)).toEqual(["version"]);
    expect(first.version).toMatch(/^[a-f0-9]{64}$/);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "own-user" } }));
    const unchanged = await (await GET(new Request("https://example.test/api/account-updates"))).json();
    expect(unchanged).toEqual(first);
    entitlement.mockResolvedValue({ source: "ADMIN_GRANT", subscriptionId: "new-grant" });
    const changed = await (await GET(new Request("https://example.test/api/account-updates"))).json();
    expect(changed.version).not.toBe(first.version);
  });
});
