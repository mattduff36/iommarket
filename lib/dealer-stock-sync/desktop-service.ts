import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import {
  browserOriginAllowed,
  DESKTOP_PAIRING_PATH,
  PAIRING_TTL_SECONDS,
  POLL_INTERVAL_SECONDS,
  resolveDesktopGate,
  SESSION_TTL_SECONDS,
  type DesktopEnvironment,
  type DesktopGate,
} from "@/lib/dealer-stock-sync/desktop-config";
import {
  createLiveDesktopStore,
  createMemoryDesktopStore,
  unavailableDesktopStore,
  type DesktopStore,
  type DeviceRecord,
  type PendingRecord,
  type SessionRecord,
} from "@/lib/dealer-stock-sync/desktop-store";

const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BEGIN_LIMIT = 5;
const POLL_LIMIT = 240;
const APPROVE_LIMIT = 10;
const DEVICE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._()'-]{0,63}$/u;
const CLIENT_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const DEVICE_ID = /^dev_[A-Za-z0-9_-]{22}$/;

export interface DesktopAccount {
  id: string;
  name: string;
  email: string;
  role: string;
  disabledAt: Date | string | null;
  deletedAt: Date | string | null;
}

export interface DesktopDependencies {
  env: Record<string, string | undefined>;
  now: () => number;
  store: DesktopStore;
  users: { findById(id: string): Promise<DesktopAccount | null> };
}

export interface DesktopFailure {
  ok: false;
  status: 400 | 401 | 403 | 429 | 503;
  error: "invalid_request" | "invalid_grant" | "unauthorized" | "forbidden" | "rate_limited" | "unavailable";
}

export interface DesktopSuccess {
  ok: true;
  status: number;
  body: Record<string, unknown>;
}

type DesktopResponse = DesktopFailure | DesktopSuccess;

function failure(status: DesktopFailure["status"], error: DesktopFailure["error"]): DesktopFailure {
  return { ok: false, status, error };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function userCode(): string {
  return [...randomBytes(8)].map((byte) => USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length]).join("");
}

function token(): string {
  return randomBytes(32).toString("base64url");
}

function deviceId(): string {
  return `dev_${randomBytes(16).toString("base64url")}`;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function exactFields(body: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(body);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

function accountAllowed(account: DesktopAccount | null, gate: DesktopGate): account is DesktopAccount {
  return Boolean(
    account &&
    account.role === "ADMIN" &&
    !account.disabledAt &&
    !account.deletedAt &&
    gate.allowlist.includes(account.id),
  );
}

function publicAccount(account: DesktopAccount) {
  return { id: account.id, name: account.name, email: account.email };
}

async function rate(
  store: DesktopStore,
  bucket: string,
  limit: number,
): Promise<DesktopFailure | null> {
  try {
    const allowed = await store.consumeRate(bucket, limit, PAIRING_TTL_SECONDS);
    return allowed ? null : failure(429, "rate_limited");
  } catch {
    return failure(503, "unavailable");
  }
}

function openUntil(value: unknown, nowMs: number): boolean {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > nowMs;
}

async function findAccount(deps: DesktopDependencies, adminId: string): Promise<DesktopAccount | null | "down"> {
  try {
    return await deps.users.findById(adminId);
  } catch {
    return "down";
  }
}

function gateOf(deps: DesktopDependencies): DesktopGate | null {
  const resolved = resolveDesktopGate(deps.env);
  return resolved.ok ? resolved.gate : null;
}

function issuedBody(tokenValue: string, session: SessionRecord, account: DesktopAccount, config?: Record<string, string>) {
  return {
    accessToken: tokenValue,
    deviceId: session.deviceId,
    expiresAt: session.expiresAt,
    environment: session.environment,
    account: publicAccount(account),
    ...(config ? { config } : {}),
  };
}

async function begin(deps: DesktopDependencies, body: Record<string, unknown>, ipHash: string): Promise<DesktopResponse> {
  if (!exactFields(body, ["op", "deviceName", "codeChallenge", "environment", "clientVersion"])) {
    return failure(400, "invalid_request");
  }
  if (typeof body.deviceName !== "string" || !DEVICE_NAME.test(body.deviceName)) return failure(400, "invalid_request");
  if (typeof body.codeChallenge !== "string" || !CHALLENGE.test(body.codeChallenge)) return failure(400, "invalid_request");
  if (body.environment !== "preview" && body.environment !== "production") return failure(400, "invalid_request");
  if (typeof body.clientVersion !== "string" || !CLIENT_VERSION.test(body.clientVersion)) return failure(400, "invalid_request");
  const gate = gateOf(deps);
  if (!gate) return failure(503, "unavailable");
  if (body.environment !== gate.environment) return failure(403, "forbidden");
  const limited = await rate(deps.store, `begin:${ipHash}`, BEGIN_LIMIT);
  if (limited) return limited;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = userCode();
    const deviceCode = token();
    const id = deviceId();
    const expiresAt = new Date(deps.now() + PAIRING_TTL_SECONDS * 1000).toISOString();
    const pending: PendingRecord = {
      status: "pending",
      challenge: body.codeChallenge,
      deviceName: body.deviceName,
      environment: gate.environment,
      clientVersion: body.clientVersion,
      deviceId: id,
      adminId: null,
      userCodeHash: hash(code),
      expiresAt,
    };
    try {
      const saved = await deps.store.savePending(hash(deviceCode), pending, PAIRING_TTL_SECONDS);
      if (saved === "conflict") continue;
    } catch {
      return failure(503, "unavailable");
    }
    return {
      ok: true,
      status: 200,
      body: {
        deviceCode,
        userCode: code,
        verificationUri: `${gate.origin}${DESKTOP_PAIRING_PATH}?code=${encodeURIComponent(code)}`,
        expiresIn: PAIRING_TTL_SECONDS,
        interval: POLL_INTERVAL_SECONDS,
      },
    };
  }
  return failure(503, "unavailable");
}

async function poll(deps: DesktopDependencies, body: Record<string, unknown>, ipHash: string): Promise<DesktopResponse> {
  if (!exactFields(body, ["op", "deviceCode", "codeVerifier"])) return failure(400, "invalid_request");
  if (typeof body.deviceCode !== "string" || !TOKEN.test(body.deviceCode)) return failure(400, "invalid_request");
  if (typeof body.codeVerifier !== "string" || !VERIFIER.test(body.codeVerifier)) return failure(400, "invalid_request");
  const gate = gateOf(deps);
  if (!gate) return failure(503, "unavailable");
  const limited = await rate(deps.store, `poll:${ipHash}`, POLL_LIMIT);
  if (limited) return limited;
  const accessToken = token();
  const tokenHash = hash(accessToken);
  const expiresAt = new Date(deps.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  let outcome: Awaited<ReturnType<DesktopStore["claim"]>>;
  try {
    outcome = await deps.store.claim(
      hash(body.deviceCode),
      challengeFor(body.codeVerifier),
      tokenHash,
      SESSION_TTL_SECONDS,
      expiresAt,
      new Date(deps.now()).toISOString(),
    );
  } catch {
    return failure(503, "unavailable");
  }
  if (outcome === "pending") return { ok: true, status: 202, body: { status: "pending" } };
  if (outcome !== "issued") return failure(400, "invalid_grant");
  let session: SessionRecord | null;
  try {
    session = await deps.store.readSession(tokenHash);
  } catch {
    return failure(503, "unavailable");
  }
  if (!session || session.environment !== gate.environment || !openUntil(session.expiresAt, deps.now())) {
    await forget(deps, tokenHash);
    return failure(503, "unavailable");
  }
  const account = await findAccount(deps, session.adminId);
  if (account === "down" || !accountAllowed(account, gate)) {
    await forget(deps, tokenHash);
    return account === "down" ? failure(503, "unavailable") : failure(403, "forbidden");
  }
  return { ok: true, status: 200, body: issuedBody(accessToken, session, account) };
}

async function forget(deps: DesktopDependencies, tokenHash: string): Promise<void> {
  try {
    await deps.store.revokeSession(tokenHash);
  } catch {
    /* Losing the session still fails closed for the caller. */
  }
}

function bearer(header: string | null): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header ?? "");
  return match?.[1] ?? null;
}

async function authorisedSession(
  deps: DesktopDependencies,
  authorization: string | null,
): Promise<{ token: string; session: SessionRecord; account: DesktopAccount; gate: DesktopGate } | DesktopFailure> {
  const gate = gateOf(deps);
  if (!gate) return failure(503, "unavailable");
  const tokenValue = bearer(authorization);
  if (!tokenValue) return failure(401, "unauthorized");
  let session: SessionRecord | null;
  try {
    session = await deps.store.readSession(hash(tokenValue));
  } catch {
    return failure(503, "unavailable");
  }
  if (!session || !openUntil(session.expiresAt, deps.now()) || session.environment !== gate.environment) {
    return failure(401, "unauthorized");
  }
  const account = await findAccount(deps, session.adminId);
  if (account === "down") return failure(503, "unavailable");
  if (!accountAllowed(account, gate)) return failure(403, "forbidden");
  return { token: tokenValue, session, account, gate };
}

async function session(deps: DesktopDependencies, body: Record<string, unknown>, authorization: string | null): Promise<DesktopResponse> {
  const keys = Object.keys(body);
  const allowed = keys.length === 1 || (keys.length === 2 && keys.includes("includeConfig"));
  if (!allowed || body.op !== "session") return failure(400, "invalid_request");
  if ("includeConfig" in body && typeof body.includeConfig !== "boolean") return failure(400, "invalid_request");
  const auth = await authorisedSession(deps, authorization);
  if (!("token" in auth)) return auth;
  const config = body.includeConfig === true ? auth.gate.configs[auth.account.id] : undefined;
  if (body.includeConfig === true && !config) return failure(503, "unavailable");
  return {
    ok: true,
    status: 200,
    body: issuedBody(auth.token, auth.session, auth.account, config ? { ...config } : undefined),
  };
}

async function revoke(deps: DesktopDependencies, body: Record<string, unknown>, authorization: string | null): Promise<DesktopResponse> {
  if (!exactFields(body, ["op"]) || body.op !== "revoke") return failure(400, "invalid_request");
  const auth = await authorisedSession(deps, authorization);
  if (!("token" in auth)) return auth;
  try {
    const removed = await deps.store.revokeSession(hash(auth.token));
    if (removed !== "ok") return failure(401, "unauthorized");
  } catch {
    return failure(503, "unavailable");
  }
  return { ok: true, status: 200, body: { status: "revoked" } };
}

export async function handleDesktopPost(
  deps: DesktopDependencies,
  input: { body: unknown; authorization: string | null; ip: string; hasQuery: boolean },
): Promise<DesktopResponse> {
  if (input.hasQuery) return failure(400, "invalid_request");
  const body = record(input.body);
  if (!body || typeof body.op !== "string") return failure(400, "invalid_request");
  const ipHash = hash(input.ip.slice(0, 64) || "unknown");
  if (body.op === "begin") return begin(deps, body, ipHash);
  if (body.op === "poll") return poll(deps, body, ipHash);
  if (body.op === "session") return session(deps, body, input.authorization);
  if (body.op === "revoke") return revoke(deps, body, input.authorization);
  return failure(400, "invalid_request");
}

export async function readDesktopInvitation(
  deps: DesktopDependencies,
  userCodeValue: string,
): Promise<{ deviceName: string; environment: DesktopEnvironment } | null> {
  if (!USER_CODE_ALPHABET.includes(userCodeValue[0] ?? "") || userCodeValue.length !== 8) return null;
  if (![...userCodeValue].every((char) => USER_CODE_ALPHABET.includes(char))) return null;
  const gate = gateOf(deps);
  if (!gate) return null;
  try {
    const invitation = await deps.store.readInvitation(hash(userCodeValue));
    if (!invitation || invitation.environment !== gate.environment) return null;
    return { deviceName: invitation.deviceName, environment: invitation.environment };
  } catch {
    return null;
  }
}

export async function approveDesktopDevice(
  deps: DesktopDependencies,
  input: { origin: string | null; host: string | null; forwardedHost: string | null; adminId: string; userCode: string },
): Promise<DesktopResponse> {
  const gate = gateOf(deps);
  if (!gate) return failure(503, "unavailable");
  if (!browserOriginAllowed(input.origin, input.host, input.forwardedHost, gate.origin)) return failure(403, "forbidden");
  const limited = await rate(deps.store, `approve:${input.adminId}`, APPROVE_LIMIT);
  if (limited) return limited;
  const account = await findAccount(deps, input.adminId);
  if (account === "down") return failure(503, "unavailable");
  if (!accountAllowed(account, gate)) return failure(403, "forbidden");
  if (![...input.userCode].every((char) => USER_CODE_ALPHABET.includes(char)) || input.userCode.length !== 8) {
    return failure(400, "invalid_grant");
  }
  try {
    const approved = await deps.store.approve(hash(input.userCode), account.id, gate.environment);
    if (approved !== "ok") return failure(400, "invalid_grant");
  } catch {
    return failure(503, "unavailable");
  }
  return { ok: true, status: 200, body: { status: "approved" } };
}

export async function revokeDesktopDevice(
  deps: DesktopDependencies,
  input: { origin: string | null; host: string | null; forwardedHost: string | null; adminId: string; deviceId: string },
): Promise<DesktopResponse> {
  const gate = gateOf(deps);
  if (!gate) return failure(503, "unavailable");
  if (!browserOriginAllowed(input.origin, input.host, input.forwardedHost, gate.origin)) return failure(403, "forbidden");
  const account = await findAccount(deps, input.adminId);
  if (account === "down") return failure(503, "unavailable");
  if (!accountAllowed(account, gate)) return failure(403, "forbidden");
  if (!DEVICE_ID.test(input.deviceId)) return failure(400, "invalid_request");
  try {
    const removed = await deps.store.revokeDevice(account.id, input.deviceId);
    if (removed !== "ok") return failure(400, "invalid_grant");
  } catch {
    return failure(503, "unavailable");
  }
  return { ok: true, status: 200, body: { status: "revoked" } };
}

export async function listDesktopDevices(deps: DesktopDependencies, adminId: string): Promise<Array<{
  deviceId: string;
  deviceName: string;
  environment: DesktopEnvironment;
  expiresAt: string;
}>> {
  const gate = gateOf(deps);
  if (!gate || !gate.allowlist.includes(adminId)) return [];
  try {
    const devices = await deps.store.listDevices(adminId);
    return devices
      .filter((device) => device.adminId === adminId && device.environment === gate.environment && openUntil(device.expiresAt, deps.now()))
      .map((device) => ({
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        environment: device.environment,
        expiresAt: device.expiresAt,
      }));
  } catch {
    return [];
  }
}

export function liveDesktopDependencies(env: Record<string, string | undefined> = process.env): DesktopDependencies {
  const gate = resolveDesktopGate(env);
  return {
    env,
    now: () => Date.now(),
    store: gate.ok ? createLiveDesktopStore(env, gate.gate.environment) : unavailableDesktopStore(),
    users: {
      async findById(id: string) {
        const user = await db.user.findUnique({
          where: { id },
          select: { id: true, name: true, email: true, role: true, disabledAt: true, deletedAt: true },
        });
        if (!user) return null;
        return { id: user.id, name: user.name ?? "", email: user.email, role: user.role, disabledAt: user.disabledAt, deletedAt: user.deletedAt };
      },
    },
  };
}

export function memoryDesktopDependencies(
  env: Record<string, string | undefined>,
  now: () => number,
  users: DesktopDependencies["users"],
): DesktopDependencies {
  const gate = resolveDesktopGate(env);
  const environment = gate.ok ? gate.gate.environment : "preview";
  return { env, now, users, store: createMemoryDesktopStore(now, environment) };
}

export type { DeviceRecord };
