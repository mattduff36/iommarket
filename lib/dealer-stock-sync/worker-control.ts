import { z } from "zod";
import {
  browserOriginAllowed,
  desktopAccountEnabled,
  resolveDesktopGate,
  type DesktopEnvironment,
} from "@/lib/dealer-stock-sync/desktop-config";
import {
  authoriseDesktopRequest,
  liveDesktopDependencies,
  type DesktopDependencies,
} from "@/lib/dealer-stock-sync/desktop-service";
import type { DeviceRecord } from "@/lib/dealer-stock-sync/desktop-store";
import {
  createLiveWorkerControlStore,
  createMemoryWorkerControlStore,
  unavailableWorkerControlStore,
  WORKER_ACTIVITY_CODES,
  WORKER_ONLINE_WINDOW_MS,
  WORKER_RUNTIME_STATES,
  type WorkerActivityCode,
  type WorkerActivityEvent,
  type WorkerCommandAction,
  type WorkerCommandRecord,
  type WorkerControlStore,
  type WorkerPresenceRecord,
  type WorkerRuntimeState,
} from "@/lib/dealer-stock-sync/worker-control-store";

const activityCodeSchema = z.enum(WORKER_ACTIVITY_CODES as unknown as [WorkerActivityCode, ...WorkerActivityCode[]]);
const runtimeStateSchema = z.enum(WORKER_RUNTIME_STATES as unknown as [WorkerRuntimeState, ...WorkerRuntimeState[]]);

export const WORKER_HEARTBEAT_RATE_LIMIT = 24;
export const WORKER_HEARTBEAT_RATE_WINDOW_SECONDS = 60;
export const WORKER_COMMAND_RATE_LIMIT = 10;
export const WORKER_COMMAND_RATE_WINDOW_SECONDS = 60;
const ACTIVITY_PAST_MS = 24 * 60 * 60 * 1000;
const ACTIVITY_FUTURE_MS = 2 * 60 * 1000;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_ID = /^dev_[A-Za-z0-9_-]{22}$/;
const DEVICE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._()'-]{0,63}$/u;

export const WORKER_ACTIVITY_TEXT: Record<WorkerActivityCode, string> = {
  checking: "Checking authorisation and the installed runtime",
  ready: "Worker ready to process queued jobs",
  waiting: "Waiting for queued work",
  processing: "Processing the current stock job",
  "staging-photos": "Preparing photos",
  "processing-finished": "Processing finished. Check the saved result below",
  applied: "Approved changes applied",
  stopping: "Stopping after the current job",
  stopped: "Stopped",
  error: "Needs attention",
};

export interface WorkerCommandView {
  id: string;
  instanceId: string;
  action: WorkerCommandAction;
}

export interface WorkerDashboardDevice {
  deviceId: string;
  deviceName: string;
  environment: DesktopEnvironment;
  instanceId: string | null;
  state: WorkerRuntimeState | null;
  online: boolean;
  lastSeenAt: string | null;
  activity: Array<{ sequence: number; code: WorkerActivityCode; text: string; at: string }>;
  pendingCommand: WorkerCommandView | null;
}

export interface WorkerControlDependencies {
  env: Record<string, string | undefined>;
  now: () => number;
  desktop: DesktopDependencies;
  control: WorkerControlStore;
  randomUUID: () => string;
}

export interface WorkerControlFailure {
  ok: false;
  status: 400 | 401 | 403 | 409 | 429 | 503;
  error: "invalid_request" | "unauthorized" | "forbidden" | "conflict" | "rate_limited" | "unavailable";
}

export interface WorkerHeartbeatSuccess {
  ok: true;
  status: 200;
  body: { ok: true; command: WorkerCommandView | null };
}

export type WorkerHeartbeatResult = WorkerControlFailure | WorkerHeartbeatSuccess;

export type WorkerDashboardResult =
  | { ok: true; devices: WorkerDashboardDevice[] }
  | { ok: false; error: "unavailable" };

export type WorkerCommandResult =
  | { ok: true; command: WorkerCommandView }
  | { ok: false; error: "invalid_request" | "forbidden" | "conflict" | "rate_limited" | "unavailable" };

function failure(status: WorkerControlFailure["status"], error: WorkerControlFailure["error"]): WorkerControlFailure {
  return { ok: false, status, error };
}

function commandView(command: WorkerCommandRecord): WorkerCommandView {
  return { id: command.id, instanceId: command.instanceId, action: command.action };
}

function isoTimestamp(value: string, nowMs: number): boolean {
  if (!ISO_TIMESTAMP.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString() === value &&
    parsed >= nowMs - ACTIVITY_PAST_MS &&
    parsed <= nowMs + ACTIVITY_FUTURE_MS;
}

const uuid = z.string().regex(UUID).transform((value) => value.toLowerCase());

function heartbeatBody(nowMs: number) {
  const event = z.object({
    sequence: z.number().int().nonnegative().max(1_000_000_000),
    code: activityCodeSchema,
    at: z.string().refine((value) => isoTimestamp(value, nowMs)),
  }).strict();
  return z.object({
    op: z.literal("heartbeat"),
    instanceId: uuid,
    state: runtimeStateSchema,
    activity: z.array(event).max(40),
    acknowledgedCommandId: uuid.nullable(),
  }).strict().superRefine((value, ctx) => {
    for (let index = 1; index < value.activity.length; index += 1) {
      const previous = value.activity[index - 1];
      const current = value.activity[index];
      if (!previous || !current || current.sequence <= previous.sequence) {
        ctx.addIssue({ code: "custom", message: "sequence" });
      }
    }
  });
}

const commandBody = z.object({
  deviceId: z.string().regex(DEVICE_ID),
  instanceId: uuid,
  action: z.enum(["start", "stop"]),
}).strict();

function gateOf(deps: WorkerControlDependencies) {
  const resolved = resolveDesktopGate(deps.env);
  return resolved.ok ? resolved.gate : null;
}

async function allowRate(
  deps: WorkerControlDependencies,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<WorkerControlFailure | null> {
  try {
    const allowed = await deps.desktop.store.consumeRate(bucket, limit, windowSeconds);
    return allowed ? null : failure(429, "rate_limited");
  } catch {
    return failure(503, "unavailable");
  }
}

function presenceOnline(presence: WorkerPresenceRecord | null, nowMs: number): boolean {
  if (!presence) return false;
  if (Date.parse(presence.lastSeenAt) !== presence.lastSeenMs) return false;
  const age = nowMs - presence.lastSeenMs;
  return age >= 0 && age <= WORKER_ONLINE_WINDOW_MS;
}

function safeActivity(events: WorkerActivityEvent[]): WorkerDashboardDevice["activity"] {
  return events.map((event) => ({
    sequence: event.sequence,
    code: event.code,
    text: WORKER_ACTIVITY_TEXT[event.code],
    at: event.at,
  }));
}

function deviceAllowed(device: DeviceRecord, adminId: string, environment: DesktopEnvironment, nowMs: number): boolean {
  if (device.adminId !== adminId || !DEVICE_ID.test(device.deviceId) || device.environment !== environment) return false;
  if (!DEVICE_NAME.test(device.deviceName)) return false;
  const expires = Date.parse(device.expiresAt);
  return Number.isFinite(expires) && expires > nowMs;
}

async function ownedDevices(
  deps: WorkerControlDependencies,
  adminId: string,
  environment: DesktopEnvironment,
): Promise<DeviceRecord[] | "down"> {
  try {
    const devices = await deps.desktop.store.listDevices(adminId);
    return devices.filter((device) => deviceAllowed(device, adminId, environment, deps.now()));
  } catch {
    return "down";
  }
}

function offlineDevice(device: DeviceRecord): WorkerDashboardDevice {
  return {
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    environment: device.environment,
    instanceId: null,
    state: null,
    online: false,
    lastSeenAt: null,
    activity: [],
    pendingCommand: null,
  };
}

export async function handleWorkerHeartbeat(
  deps: WorkerControlDependencies,
  input: { body: unknown; authorization: string | null },
): Promise<WorkerHeartbeatResult> {
  const parsed = heartbeatBody(deps.now()).safeParse(input.body);
  if (!parsed.success) return failure(400, "invalid_request");
  const gate = gateOf(deps);
  if (!gate) return failure(503, "unavailable");
  let auth: Awaited<ReturnType<typeof authoriseDesktopRequest>>;
  try {
    auth = await authoriseDesktopRequest(deps.desktop, input.authorization);
  } catch {
    return failure(503, "unavailable");
  }
  if (!auth.ok) return auth.error === "invalid_grant" ? failure(401, "unauthorized") : failure(auth.status, auth.error);
  if (auth.principal.environment !== gate.environment || !desktopAccountEnabled(deps.env, auth.principal.adminId)) {
    return failure(403, "forbidden");
  }
  const limited = await allowRate(
    deps,
    `worker-heartbeat:${auth.principal.deviceId}`,
    WORKER_HEARTBEAT_RATE_LIMIT,
    WORKER_HEARTBEAT_RATE_WINDOW_SECONDS,
  );
  if (limited) return limited;
  const seen = deps.now();
  const presence: WorkerPresenceRecord = {
    instanceId: parsed.data.instanceId,
    state: parsed.data.state,
    activity: parsed.data.activity.map((event) => ({ ...event })),
    lastSeenAt: new Date(seen).toISOString(),
    lastSeenMs: seen,
    acknowledgedCommandId: null,
  };
  try {
    const command = await deps.control.recordHeartbeat({
      adminId: auth.principal.adminId,
      deviceId: auth.principal.deviceId,
      presence,
      acknowledgedCommandId: parsed.data.acknowledgedCommandId,
    });
    return { ok: true, status: 200, body: { ok: true, command: command ? commandView(command) : null } };
  } catch {
    return failure(503, "unavailable");
  }
}

export async function readWorkerDashboard(
  deps: WorkerControlDependencies,
  adminId: string,
): Promise<WorkerDashboardResult> {
  const gate = gateOf(deps);
  if (!gate || !desktopAccountEnabled(deps.env, adminId)) return { ok: false, error: "unavailable" };
  const devices = await ownedDevices(deps, adminId, gate.environment);
  if (devices === "down") return { ok: false, error: "unavailable" };
  try {
    const rows: WorkerDashboardDevice[] = [];
    for (const device of devices) {
      const snapshot = await deps.control.readDevice(adminId, device.deviceId);
      if (!snapshot.presence) {
        rows.push(offlineDevice(device));
        continue;
      }
      const online = presenceOnline(snapshot.presence, deps.now());
      const pending = snapshot.command && snapshot.command.instanceId === snapshot.presence.instanceId
        ? commandView(snapshot.command)
        : null;
      rows.push({
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        environment: device.environment,
        instanceId: snapshot.presence.instanceId,
        state: snapshot.presence.state,
        online,
        lastSeenAt: snapshot.presence.lastSeenAt,
        activity: safeActivity(snapshot.presence.activity),
        pendingCommand: pending,
      });
    }
    return { ok: true, devices: rows };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function commandWorkerDevice(
  deps: WorkerControlDependencies,
  input: {
    adminId: string;
    origin: string | null;
    host: string | null;
    forwardedHost: string | null;
    body: unknown;
  },
): Promise<WorkerCommandResult> {
  const gate = gateOf(deps);
  if (!gate || !desktopAccountEnabled(deps.env, input.adminId)) return { ok: false, error: "unavailable" };
  if (!browserOriginAllowed(input.origin, input.host, input.forwardedHost, gate.origin)) {
    return { ok: false, error: "forbidden" };
  }
  const parsed = commandBody.safeParse(input.body);
  if (!parsed.success) return { ok: false, error: "invalid_request" };
  const devices = await ownedDevices(deps, input.adminId, gate.environment);
  if (devices === "down") return { ok: false, error: "unavailable" };
  const owned = devices.find((device) => device.deviceId === parsed.data.deviceId);
  if (!owned) return { ok: false, error: "forbidden" };
  const limited = await allowRate(
    deps,
    `worker-command:${input.adminId}`,
    WORKER_COMMAND_RATE_LIMIT,
    WORKER_COMMAND_RATE_WINDOW_SECONDS,
  );
  if (limited) return { ok: false, error: limited.error === "rate_limited" ? "rate_limited" : "unavailable" };
  const nowMs = deps.now();
  const command: WorkerCommandRecord = {
    id: deps.randomUUID(),
    instanceId: parsed.data.instanceId,
    action: parsed.data.action,
  };
  if (!UUID.test(command.id)) return { ok: false, error: "unavailable" };
  try {
    const written = await deps.control.putCommand({
      adminId: input.adminId,
      deviceId: owned.deviceId,
      instanceId: parsed.data.instanceId,
      command,
      nowMs,
    });
    if (written !== "ok") return { ok: false, error: "conflict" };
    return { ok: true, command: commandView(command) };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export function createWorkerControlDependencies(
  env: Record<string, string | undefined> = process.env,
): WorkerControlDependencies {
  const gate = resolveDesktopGate(env);
  const environment = gate.ok ? gate.gate.environment : "preview";
  return {
    env,
    now: () => Date.now(),
    desktop: liveDesktopDependencies(env),
    control: gate.ok ? createLiveWorkerControlStore(env, environment) : unavailableWorkerControlStore(),
    randomUUID: () => crypto.randomUUID(),
  };
}

export function memoryWorkerControlDependencies(
  desktop: DesktopDependencies,
  now: () => number,
): WorkerControlDependencies {
  const gate = resolveDesktopGate(desktop.env);
  const environment = gate.ok ? gate.gate.environment : "preview";
  let sequence = 0;
  return {
    env: desktop.env,
    now,
    desktop,
    control: createMemoryWorkerControlStore(now, environment),
    randomUUID: () => {
      sequence += 1;
      return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
    },
  };
}

