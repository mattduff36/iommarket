import { describe, expect, it } from "vitest";
import { mintDesktopLaunch, redeemDesktopLaunch, type LaunchDependencies } from "@/lib/dealer-stock-sync/desktop-launch";
import { memoryLaunchStore } from "@/lib/dealer-stock-sync/desktop-launch-store";
import { memoryDesktopDependencies, type DesktopAccount } from "@/lib/dealer-stock-sync/desktop-service";

const ADMIN = "cadmin0000000000000000001";
const OTHER = "cadmin0000000000000000002";
const JOB = "cjob000000000000000000001";
function harness() {
  let now = Date.parse("2026-11-01T23:00:00Z");
  const accounts = new Map<string, DesktopAccount>([ADMIN, OTHER].map(id => [id, {
    id, name: "Admin", email: "admin@example.com", role: "ADMIN", disabledAt: null, deletedAt: null,
  }]));
  const env = { DEALER_STOCK_DESKTOP_ENABLED: "1", DEALER_STOCK_DESKTOP_API_ONLY: "1",
    DEALER_STOCK_DESKTOP_ALLOWED_ADMIN_IDS: `${ADMIN},${OTHER}`, VERCEL_ENV: "preview", DEALER_STOCK_SYNC_TARGET: "preview",
    NEXT_PUBLIC_APP_URL: "https://itrader.dev", NEXT_PUBLIC_SUPABASE_URL: "https://syneonzucehwlghqmfbg.supabase.co",
    DATABASE_URL: "postgresql://postgres:test@db.syneonzucehwlghqmfbg.supabase.co:5432/postgres" };
  const desktop = memoryDesktopDependencies(env, () => now, { async findById(id) { return accounts.get(id) ?? null; } });
  const deps: LaunchDependencies = { desktop, tickets: memoryLaunchStore(() => now), jobsOwned: async (id, jobs) => id === ADMIN && jobs.every(job => job === JOB) };
  const mint = (body: unknown = { mode: "open" }, changes = {}) => mintDesktopLaunch(deps, {
    adminId: ADMIN, origin: "https://itrader.dev", host: "itrader.dev", forwardedHost: null, body, ...changes,
  });
  const redeem = (ticket: string, authorization: string | null = null) => redeemDesktopLaunch(deps, {
    body: { op: "redeem", ticket, deviceName: "Front Desk", clientVersion: "1.1.11" }, authorization, ip: "203.0.113.1",
  });
  return { deps, accounts, mint, redeem, advance: () => { now += 91_000; } };
}
function ticket(result: Awaited<ReturnType<typeof mintDesktopLaunch>>) {
  if (!result.ok) throw new Error("Launch mint failed");
  return new URL(result.url).searchParams.get("ticket")!;
}
describe("website desktop launch authorization", () => {
  it("issues a scoped session once and never includes bearer credentials in the URI", async () => {
    const h = harness(); const minted = await h.mint();
    const secret = ticket(minted);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(minted).toMatchObject({ ok: true });
    const response = await h.redeem(secret);
    expect(response).toMatchObject({ status: 200, body: { mode: "open", jobIds: [], closeAfterRun: false,
      session: { environment: "preview", account: { id: ADMIN } } } });
    expect(await h.redeem(secret)).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
  });
  it("allows only one concurrent redemption", async () => {
    const h = harness(); const secret = ticket(await h.mint());
    const responses = await Promise.all([h.redeem(secret), h.redeem(secret)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 400]);
  });
  it("expires tickets and rechecks revoked admins at redemption", async () => {
    const h = harness(); const secret = ticket(await h.mint()); h.advance();
    expect((await h.redeem(secret)).status).toBe(400);
    const fresh = ticket(await h.mint()); h.accounts.get(ADMIN)!.disabledAt = new Date();
    expect((await h.redeem(fresh)).status).toBe(403);
  });
  it("rejects CSRF, missing origin, unknown fields and foreign or empty task scope", async () => {
    const h = harness();
    expect(await h.mint(undefined, { origin: "https://evil.example" })).toMatchObject({ ok: false });
    expect(await h.mint(undefined, { origin: null })).toMatchObject({ ok: false });
    for (const body of [{ mode: "task", jobIds: [] }, { mode: "task", jobIds: ["cforeign00000000000000001"] },
      { mode: "open", jobIds: [JOB] }, { mode: "open", environment: "production" }]) {
      expect(await h.mint(body)).toMatchObject({ ok: false });
    }
  });
  it("seals the exact already queued job scope", async () => {
    const h = harness();
    expect(await h.redeem(ticket(await h.mint({ mode: "task", jobIds: [JOB] })))).toMatchObject({
      status: 200, body: { mode: "task", jobIds: [JOB], closeAfterRun: true },
    });
  });
  it("reuses a matching session and refuses a different account", async () => {
    const h = harness(); const first = await h.redeem(ticket(await h.mint()));
    if (!("session" in first.body)) throw new Error("Session was not issued");
    const session = first.body.session;
    const reused = await h.redeem(ticket(await h.mint()), `Bearer ${session.accessToken}`);
    expect(reused).toMatchObject({ status: 200, body: { session: { deviceId: session.deviceId } } });
    const foreign = ticket(await h.mint({ mode: "open" }, { adminId: OTHER }));
    expect(await h.redeem(foreign, `Bearer ${session.accessToken}`)).toMatchObject({ status: 409 });
  });
  it("rejects a stored ticket for another environment", async () => {
    const h = harness(); const secret = ticket(await h.mint());
    const original = h.deps.tickets.take;
    h.deps.tickets.take = async hash => { const value = await original(hash); return value ? { ...value, environment: "production" } : null; };
    expect((await h.redeem(secret)).status).toBe(400);
  });
});
