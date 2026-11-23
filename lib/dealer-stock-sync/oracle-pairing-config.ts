import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { resolveDesktopGate } from "./desktop-config";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const profileSchema = z.array(z.object({
  adminId: z.string().regex(/^c[a-z0-9]{24,32}$/),
  token: z.string().regex(tokenPattern),
}).strict()).min(1).max(2);
export type OracleProfile = z.infer<typeof profileSchema>[number];

export function oracleDeployment(env: Record<string, string | undefined>) {
  const hosted = env.VERCEL_ENV;
  if (hosted !== "preview" && hosted !== "production") return null;
  if (hosted === "production" && env.ORACLE_STOCK_PRODUCTION_ENABLED !== "1") return null;
  const resolved = resolveDesktopGate(env);
  const origin = hosted === "preview" ? "https://itrader.dev" : "https://itrader.im";
  if (!resolved.ok || resolved.gate.environment !== hosted || resolved.gate.origin !== origin) return null;
  return { environment: hosted, origin, allowlist: resolved.gate.allowlist } as const;
}

export function oracleProfiles(env: Record<string, string | undefined>, gate = oracleDeployment(env)): OracleProfile[] {
  if (!gate) return [];
  const raw = env.ORACLE_PAIRING_PROFILES;
  if (!raw || raw.length > 2048) return [];
  try {
    const result = profileSchema.safeParse(JSON.parse(raw));
    if (!result.success) return [];
    const profiles = result.data;
    if (new Set(profiles.map(p => p.adminId)).size !== profiles.length ||
      new Set(profiles.map(p => p.token)).size !== profiles.length) return [];
    return profiles.filter(p => gate.allowlist.includes(p.adminId));
  } catch { return []; }
}

export function profileForBearer(profiles: readonly OracleProfile[], authorization: string | null) {
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const token = authorization.slice(7);
  if (!tokenPattern.test(token)) return undefined;
  const provided = Buffer.from(token);
  return profiles.find(profile => provided.length === profile.token.length &&
    timingSafeEqual(provided, Buffer.from(profile.token)));
}
