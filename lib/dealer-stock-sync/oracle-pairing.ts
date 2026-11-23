import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Redis } from "@upstash/redis";
import { z } from "zod";
import { oracleDeployment, type OracleProfile } from "./oracle-pairing-config";

const codeSchema = z.string().regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
const id = z.uuid();
export const oracleMessageSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("poll") }).strict(),
  z.object({ op: z.literal("ready"), requestId: id, code: codeSchema }).strict(),
  z.object({ op: z.literal("failed"), requestId: id }).strict(),
]);
type OracleMessage = z.infer<typeof oracleMessageSchema>;

const poll = `
redis.call('SET', KEYS[1], '1', 'EX', 90)
return redis.call('GET', KEYS[2]) or ''
`;
// Repeated clicks and parallel tabs reuse the same request. A new browser action
// never extends an existing code or request's expiry.
const start = `
if redis.call('EXISTS', KEYS[1]) == 0 then return '' end
local value = redis.call('GET', KEYS[2])
if value and value ~= ARGV[2] then return value end
redis.call('SET', KEYS[2], ARGV[1], 'EX', 75)
return ARGV[1]
`;
const fail = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], 'failed', 'EX', 4)
return 1
`;
// Bind to a genuine, pending PKCE Linux invitation before its user-facing
// approval code can be returned. The desktop approval transaction checks the
// owner marker for the entire lifetime of the invitation, on every approval path.
const publish = `
local existing = redis.call('GET', KEYS[1])
if existing == ARGV[2] then return 1 end
if existing ~= ARGV[1] then return 0 end
if redis.call('GET', KEYS[2]) ~= KEYS[3] then return 0 end
local raw = redis.call('GET', KEYS[3])
if not raw then return 0 end
local inv = cjson.decode(raw)
if inv.status ~= 'pending' or inv.environment ~= ARGV[5]
  or inv.clientVersion ~= '1.1.15-linux.1' or inv.deviceName ~= 'Oracle Stock Update VM'
  or inv.userCodeHash ~= ARGV[4] then return 0 end
local ttl = redis.call('PTTL', KEYS[3])
if ttl < 1000 then return 0 end
local owner = redis.call('GET', KEYS[4])
if owner and owner ~= ARGV[3] then return 0 end
redis.call('SET', KEYS[4], ARGV[3], 'PX', ttl + 1000)
redis.call('SET', KEYS[1], ARGV[2], 'PX', math.min(ttl, 60000))
return 1
`;

export function oraclePairingStore(profile: OracleProfile, env: Record<string, string | undefined> = process.env) {
  const deployment = oracleDeployment(env);
  if (!deployment || !deployment.allowlist.includes(profile.adminId)) throw new Error("Oracle pairing is disabled");
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url?.startsWith("https://") || !token) throw new Error("Oracle pairing store is unavailable");
  const redis = new Redis({ url, token });
  const generation = createHash("sha256").update(profile.token).digest("hex").slice(0, 24);
  const base = `itrader:oracle-pairing:${deployment.environment}:${profile.adminId}:${generation}`;
  const desktop = `itrader:stock-desktop:${deployment.environment}:`;
  const presence = base + ":presence", request = base + ":request";
  return {
    async available() { return Boolean(await redis.exists(presence)); },
    async agent(message: OracleMessage) {
      if (message.op === "poll") {
        const value = await redis.eval<string[], string>(poll, [presence, request], []);
        return { ok: true as const, requestId: id.safeParse(value).success ? value : null };
      }
      if (message.op === "failed") {
        return { ok: Boolean(await redis.eval(fail, [request], [message.requestId])) };
      }
      const hash = createHash("sha256").update(message.code).digest("hex");
      const pointer = desktop + "user:" + hash;
      const pending = await redis.get<string>(pointer);
      if (!pending?.startsWith(desktop + "pending:")) return { ok: false };
      const ready = message.requestId + ":" + message.code;
      const ok = await redis.eval(publish, [request, pointer, pending, desktop + "oracle-owner:" + hash],
        [message.requestId, ready, profile.adminId, hash, deployment.environment]);
      return { ok: Boolean(ok) };
    },
    async invitation(): Promise<{ code: string } | { error: string }> {
      const freshId = randomUUID();
      let value = await redis.eval<string[], string>(start, [presence, request], [freshId, ""]);
      const deadline = Date.now() + 40_000;
      while (value && value !== "failed") {
        const [requestId, code] = value.split(":");
        if (!id.safeParse(requestId).success) break;
        if (codeSchema.safeParse(code).success) {
          const hash = createHash("sha256").update(code).digest("hex");
          if (await redis.exists(desktop + "user:" + hash)) return { code };
          // A previous tab may have consumed this code already. Replace only
          // that completed request; another tab may already be waiting on a new one.
          value = await redis.eval<string[], string>(start, [presence, request], [freshId, value]);
          continue;
        }
        if (Date.now() >= deadline) return { error: "The VM has not replied yet. Try linking again." };
        await delay(1800);
        value = await redis.get<string>(request) ?? "";
      }
      return { error: "The VM could not start pairing. Check its connection and try again." };
    },
  };
}
