export const AUTH_TOKEN_COLUMNS = [
  "confirmation_token",
  "recovery_token",
  "email_change_token_new",
  "email_change_token_current",
  "phone_change_token",
  "reauthentication_token",
  "email_change",
  "phone_change",
] as const;

export const SCRUBBED_PASSWORD = "";
export const BANNED_UNTIL = "infinity";
const SECRET_KEY = /token|secret|password|credential|refresh/i;

export type AdminIdentity = { id: string; email: string; authUserId: string };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function scrubAuthUser(row: Record<string, unknown>, instanceId: string): Record<string, unknown> {
  const next: Record<string, unknown> = { ...row, instance_id: instanceId, encrypted_password: SCRUBBED_PASSWORD, banned_until: BANNED_UNTIL };
  for (const column of AUTH_TOKEN_COLUMNS) if (column in next) next[column] = "";
  return next;
}

export function scrubIdentity(row: Record<string, unknown>): Record<string, unknown> {
  const next = { ...row };
  if (typeof next.identity_data === "string") {
    try { next.identity_data = JSON.parse(next.identity_data) as unknown; } catch { return next; }
  }
  if (next.identity_data && typeof next.identity_data === "object" && !Array.isArray(next.identity_data)) {
    next.identity_data = Object.fromEntries(Object.entries(next.identity_data as Record<string, unknown>).filter(([key]) => !SECRET_KEY.test(key)));
  }
  return next;
}

export function authScrubViolations(row: Record<string, unknown>): string[] {
  const violations: string[] = [];
  if (row.banned_until !== BANNED_UNTIL) violations.push("banned_until");
  if (row.encrypted_password !== SCRUBBED_PASSWORD) violations.push("encrypted_password");
  for (const column of AUTH_TOKEN_COLUMNS) {
    if (column in row && row[column] != null && row[column] !== "") violations.push(column);
  }
  const identity = row.identity_data;
  if (identity && typeof identity === "object" && !Array.isArray(identity)) {
    for (const key of Object.keys(identity)) if (SECRET_KEY.test(key)) violations.push(key);
  }
  return violations;
}

export function adminIdentityCollision(preserved: readonly AdminIdentity[], source: AdminIdentity): string | null {
  for (const admin of preserved) {
    const sameId = admin.id === source.id;
    const sameEmail = normalizeEmail(admin.email) === normalizeEmail(source.email);
    const sameAuth = admin.authUserId === source.authUserId;
    if (!sameId && !sameEmail && !sameAuth) continue;
    if (sameId && sameEmail && sameAuth) continue;
    return `Staging administrator ${admin.id} collides with production identity ${source.id}.`;
  }
  return null;
}

export function preservedAuthCollision(preserved: readonly AdminIdentity[], sourceAuthId: string, sourcePublicId: string | null): string | null {
  const admin = preserved.find((item) => item.authUserId === sourceAuthId || item.id === sourcePublicId);
  if (!admin) return null;
  if (admin.authUserId === sourceAuthId && admin.id === sourcePublicId) return null;
  return `Production auth subject ${sourceAuthId} collides with staging administrator ${admin.id}.`;
}
