const PROJECT_REF = /^[a-z0-9]{20}$/;
/** Unquoted PostgreSQL identifier, bounded by NAMEDATALEN (63). */
const POSTGRES_ROLE = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;
const DIRECT_HOST = /^db\.([a-z0-9]{20})\.supabase\.co$/;
const POOLER_SUFFIX = ".pooler.supabase.com";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);
const ALLOWED_PORTS = new Set(["", "5432", "6543"]);

export type SupabaseConnectionKind = "loopback" | "direct" | "pooler";

export interface SupabaseConnectionIdentity {
  kind: SupabaseConnectionKind;
  /** Null for loopback. Otherwise the 20-character project ref. */
  projectRef: string | null;
  /** Pooler login role. Null for loopback and direct hosts. */
  role: string | null;
}

function isPoolerHost(hostname: string): boolean {
  if (!hostname.endsWith(POOLER_SUFFIX)) return false;
  const prefix = hostname.slice(0, -POOLER_SUFFIX.length);
  if (!prefix || prefix.startsWith(".") || prefix.endsWith(".") || prefix.includes("..")) return false;
  return prefix.split(".").every((label) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

/** Shared-pooler login is `<role>.<project-ref>`, including the built-in postgres role. */
export function parsePooledLogin(username: string): { role: string; projectRef: string } | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(username);
  } catch {
    return null;
  }
  if (decoded.includes("%") || decoded.includes("/") || decoded.includes("@")) return null;
  const parts = decoded.split(".");
  if (parts.length !== 2) return null;
  const [role, projectRef] = parts;
  if (!role || !projectRef || !POSTGRES_ROLE.test(role) || !PROJECT_REF.test(projectRef)) return null;
  return { role, projectRef };
}

/**
 * Pure Supabase Postgres URL classifier.
 * Loopback is only localhost and 127.0.0.1. Callers that also allow `[::1]` keep that check themselves.
 */
export function parseSupabaseConnectionIdentity(raw: string): SupabaseConnectionIdentity | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return null;
  if (LOOPBACK_HOSTS.has(url.hostname)) {
    return { kind: "loopback", projectRef: null, role: null };
  }
  if (!ALLOWED_PORTS.has(url.port)) return null;
  const direct = DIRECT_HOST.exec(url.hostname);
  if (direct?.[1]) return { kind: "direct", projectRef: direct[1], role: null };
  if (!isPoolerHost(url.hostname)) return null;
  const pooled = parsePooledLogin(url.username);
  if (!pooled) return null;
  return { kind: "pooler", projectRef: pooled.projectRef, role: pooled.role };
}
