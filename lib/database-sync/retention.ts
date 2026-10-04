export const BACKUP_BUDGET_BYTES = 500 * 1024 * 1024;
export const MAX_RETAINED_BACKUPS = 5;
export const BACKUP_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type BackupPoint = {
  id: string;
  createdAt: number;
  bytes: number;
  expiresAt: number | null;
  newest: boolean;
};

export type RetentionPlan = {
  ok: true;
  dropIds: string[];
  expireUpdates: Array<{ id: string; expiresAt: number }>;
} | { ok: false; reason: string };

export function planBackupRetention(existing: readonly BackupPoint[], now: number, incoming: { id: string; bytes: number }): RetentionPlan {
  if (incoming.bytes > BACKUP_BUDGET_BYTES) return { ok: false, reason: "The newest backup exceeds the 500 MB ciphertext limit. Nothing was changed." };
  const previous = existing.find((point) => point.newest);
  const points: BackupPoint[] = existing.map((point) => point.id === previous?.id
    ? { ...point, newest: false, expiresAt: now + BACKUP_TTL_MS }
    : { ...point });
  points.push({ id: incoming.id, createdAt: now, bytes: incoming.bytes, expiresAt: null, newest: true });
  const drop = new Set<string>();
  for (const point of points) {
    if (!point.newest && point.expiresAt !== null && point.expiresAt <= now) drop.add(point.id);
  }
  const active = () => points.filter((point) => !drop.has(point.id));
  const oldest = () => active().filter((point) => !point.newest).sort((left, right) => left.createdAt - right.createdAt)[0];
  while (active().length > MAX_RETAINED_BACKUPS) {
    const point = oldest();
    if (!point) break;
    drop.add(point.id);
  }
  while (active().reduce((sum, point) => sum + point.bytes, 0) > BACKUP_BUDGET_BYTES) {
    const point = oldest();
    if (!point) break;
    drop.add(point.id);
  }
  return {
    ok: true,
    dropIds: [...drop],
    expireUpdates: previous ? [{ id: previous.id, expiresAt: now + BACKUP_TTL_MS }] : [],
  };
}
