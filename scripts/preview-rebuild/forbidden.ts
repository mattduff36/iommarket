export const PREVIEW_REBUILD_FORBIDDEN = [
  "db:push",
  "db:migrate",
  "prisma migrate",
  "prisma db push",
  "prod-mirror restore",
  "prod-mirror copy-waitlist",
  "prod-mirror copy-storage",
  "prod-mirror rewrite-urls",
] as const;

export function findForbiddenRebuildOps(source: string) {
  const lower = source.toLowerCase();
  return PREVIEW_REBUILD_FORBIDDEN.filter((needle) => lower.includes(needle.toLowerCase()));
}
