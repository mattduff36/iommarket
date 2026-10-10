export interface LeasableJob {
  id: string;
  bindingId: string;
  status: "QUEUED" | "LEASED" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  leaseExpiresAt: string | null;
  createdAt: string;
}

export const LEASE_JOB_SQL = `
UPDATE "DealerStockSyncJob" AS job
SET "status" = 'LEASED',
    "leaseOwner" = $1,
    "leaseExpiresAt" = $2,
    "attempt" = job."attempt" + 1,
    "startedAt" = COALESCE(job."startedAt", NOW())
WHERE job."id" = (
  SELECT candidate."id"
  FROM "DealerStockSyncJob" AS candidate
  JOIN "DealerStockSourceBinding" AS binding ON binding."id" = candidate."bindingId"
  WHERE (
    candidate."status" = 'QUEUED'
    OR (candidate."status" = 'LEASED' AND candidate."leaseExpiresAt" < NOW())
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "DealerStockSyncJob" AS other
    WHERE other."bindingId" = candidate."bindingId"
      AND other."id" <> candidate."id"
      AND other."status" = 'LEASED'
      AND other."leaseExpiresAt" > NOW()
  )
  ORDER BY candidate."createdAt" ASC
  FOR UPDATE OF binding, candidate SKIP LOCKED
  LIMIT 1
)
RETURNING job."id"
`;

export function chooseLeasableJob<T extends LeasableJob>(jobs: T[], now: Date) {
  const activeBindings = new Set(
    jobs
      .filter(
        (job) =>
          job.status === "LEASED" &&
          job.leaseExpiresAt != null &&
          new Date(job.leaseExpiresAt).getTime() > now.getTime(),
      )
      .map((job) => job.bindingId),
  );
  return (
    [...jobs]
      .filter((job) => {
        if (activeBindings.has(job.bindingId) && job.status !== "QUEUED") return false;
        if (activeBindings.has(job.bindingId)) return false;
        if (job.status === "QUEUED") return true;
        return (
          job.status === "LEASED" &&
          (job.leaseExpiresAt == null || new Date(job.leaseExpiresAt).getTime() <= now.getTime())
        );
      })
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0] ?? null
  );
}
