import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { browserOriginAllowed, resolveDesktopGate, SESSION_TTL_SECONDS } from "./desktop-config";
import { handleDesktopPost, liveDesktopDependencies, type DesktopAccount, type DesktopDependencies } from "./desktop-service";
import { createLaunchStore, launchJobIds, LAUNCH_TTL_SECONDS, type DesktopLaunchStore, type LaunchRecord } from "./desktop-launch-store";

const mintSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("open"), jobIds: z.array(z.never()).optional() }).strict(),
  z.object({ mode: z.literal("task"), jobIds: launchJobIds }).strict(),
]);
const redeemSchema = z.object({
  op: z.literal("redeem"), ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  deviceName: z.string().regex(/^[\p{L}\p{N}][\p{L}\p{N} ._()'-]{0,63}$/u),
  clientVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/),
}).strict();
export interface LaunchDependencies {
  desktop: DesktopDependencies; tickets: DesktopLaunchStore;
  jobsOwned: (adminId: string, ids: string[]) => Promise<boolean>;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("base64url");
function allowed(account: DesktopAccount | null, ids: readonly string[]): account is DesktopAccount {
  return !!account && account.role === "ADMIN" && !account.disabledAt && !account.deletedAt && ids.includes(account.id);
}
export function liveLaunchDependencies(): LaunchDependencies {
  const desktop = liveDesktopDependencies();
  const resolved = resolveDesktopGate(desktop.env);
  if (!resolved.ok) throw new Error("Launch service unavailable.");
  return { desktop, tickets: createLaunchStore(desktop.env, resolved.gate.environment),
    async jobsOwned(adminId, ids) {
      return await db.dealerStockSyncJob.count({ where: {
        id: { in: ids }, createdById: adminId, status: { in: ["QUEUED", "LEASED"] },
      } }) === ids.length;
    },
  };
}
export type LaunchResult = { ok: true; url: string; launchId: string } | { ok: false; error: string };
export async function mintDesktopLaunch(deps: LaunchDependencies, input: {
  adminId: string; origin: string | null; host: string | null; forwardedHost: string | null; body: unknown;
}): Promise<LaunchResult> {
  const denied: LaunchResult = { ok: false, error: "Could not open Stock Update. Check your connection and try again." };
  try {
    const parsed = mintSchema.safeParse(input.body);
    const resolved = resolveDesktopGate(deps.desktop.env);
    if (!parsed.success || !resolved.ok) return denied;
    const gate = resolved.gate;
    if (!browserOriginAllowed(input.origin, input.host, input.forwardedHost, gate.origin) ||
      !allowed(await deps.desktop.users.findById(input.adminId), gate.allowlist)) return denied;
    if (!await deps.desktop.store.consumeRate(`launch-mint:${input.adminId}`, 10, 60)) return denied;
    const jobIds = parsed.data.jobIds ?? [];
    if (jobIds.length && !await deps.jobsOwned(input.adminId, jobIds)) return { ok: false, error: "These jobs are no longer available. Refresh Stock Reviews." };
    const ticket = token();
    const record: LaunchRecord = { adminId: input.adminId, environment: gate.environment,
      launchId: randomUUID(), mode: parsed.data.mode, jobIds, expiresAt: deps.desktop.now() + LAUNCH_TTL_SECONDS * 1000 };
    if (!await deps.tickets.put(hash(ticket), record)) return denied;
    return { ok: true, url: `itrader-stock-update://launch?environment=${gate.environment}&ticket=${ticket}`, launchId: record.launchId };
  } catch { return denied; }
}

async function issueSession(deps: DesktopDependencies, account: DesktopAccount, record: LaunchRecord, deviceName: string, clientVersion: string) {
  const accessToken = token();
  const deviceHash = hash(token());
  const userCodeHash = hash(token());
  const challenge = token();
  const expiresAt = new Date(deps.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  const deviceId = `dev_${randomBytes(16).toString("base64url")}`;
  const saved = await deps.store.savePending(deviceHash, { status: "approved", challenge, deviceName,
    environment: record.environment, clientVersion, deviceId, adminId: account.id, userCodeHash,
    expiresAt: new Date(deps.now() + LAUNCH_TTL_SECONDS * 1000).toISOString() }, LAUNCH_TTL_SECONDS);
  if (saved !== "ok" || await deps.store.claim(deviceHash, challenge, hash(accessToken), SESSION_TTL_SECONDS, expiresAt,
    new Date(deps.now()).toISOString()) !== "issued") throw new Error("Session unavailable.");
  return { accessToken, deviceId, expiresAt, environment: record.environment,
    account: { id: account.id, name: account.name, email: account.email } };
}

export async function redeemDesktopLaunch(deps: LaunchDependencies, input: { body: unknown; authorization: string | null; ip: string }) {
  const fail = (status: number, error: string) => ({ status, body: { error } });
  try {
    const parsed = redeemSchema.safeParse(input.body);
    const resolved = resolveDesktopGate(deps.desktop.env);
    if (!parsed.success) return fail(400, "invalid_request");
    if (!resolved.ok) return fail(503, "unavailable");
    if (!await deps.desktop.store.consumeRate(`launch-redeem:${hash(input.ip.slice(0, 64))}`, 20, 60)) return fail(429, "rate_limited");
    const record = await deps.tickets.take(hash(parsed.data.ticket));
    if (!record || record.expiresAt <= deps.desktop.now() || record.environment !== resolved.gate.environment) return fail(400, "invalid_grant");
    const account = await deps.desktop.users.findById(record.adminId);
    if (!allowed(account, resolved.gate.allowlist)) return fail(403, "forbidden");
    if (record.mode === "task" && !await deps.jobsOwned(account.id, record.jobIds)) return fail(409, "conflict");
    let session: Record<string, unknown> | undefined;
    if (input.authorization) {
      const existing = await handleDesktopPost(deps.desktop, { body: { op: "session" }, authorization: input.authorization, ip: input.ip, hasQuery: false });
      if (existing.ok) {
        const owner = existing.body.account as { id?: string } | undefined;
        if (owner?.id !== account.id || existing.body.environment !== record.environment) return fail(409, "conflict");
        session = existing.body;
      } else if (existing.status !== 401) return fail(existing.status, existing.error);
    }
    session ??= await issueSession(deps.desktop, account, record, parsed.data.deviceName, parsed.data.clientVersion);
    return { status: 200, body: { session, launchId: record.launchId, mode: record.mode,
      jobIds: record.jobIds, closeAfterRun: record.mode === "task" } };
  } catch { return fail(503, "unavailable"); }
}
