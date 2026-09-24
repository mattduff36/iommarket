export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import {
  AdminFilterBar,
  adminSearchButtonClass,
  adminSearchInputClass,
} from "@/components/admin/admin-filter-bar";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminPager } from "@/components/admin/admin-pager";
import { adminTotalPages, parseAdminPage } from "@/lib/admin/query";

export const metadata: Metadata = { title: "Admin Audit" };

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ entityType?: string; entityId?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = parseAdminPage(params.page);
  const where = {
    ...(params.entityType ? { entityType: params.entityType } : {}),
    ...(params.entityId ? { entityId: params.entityId } : {}),
  };

  const [logs, total] = await Promise.all([
    db.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * 50,
      take: 50,
    }),
    db.adminAuditLog.count({ where }),
  ]);
  const totalPages = adminTotalPages(total, 50);
  const filterQuery = new URLSearchParams({
    ...(params.entityType ? { entityType: params.entityType } : {}),
    ...(params.entityId ? { entityId: params.entityId } : {}),
  }).toString();

  return (
    <>
      <AdminPageHeader
        title="Admin audit"
        description="Trace administrative actions by entity and record identifier."
      />
      <AdminFilterBar count={`${total} ${total === 1 ? "entry" : "entries"}`}>
        <form className="flex min-w-0 flex-1 flex-wrap gap-2" method="get">
          <input
            name="entityType"
            defaultValue={params.entityType ?? ""}
            placeholder="Entity type"
            aria-label="Filter by entity type"
            className={adminSearchInputClass}
          />
          <input
            name="entityId"
            defaultValue={params.entityId ?? ""}
            placeholder="Entity ID"
            aria-label="Filter by entity ID"
            className={adminSearchInputClass}
          />
          <button type="submit" className={adminSearchButtonClass}>
            Filter
          </button>
        </form>
      </AdminFilterBar>
      <div className="space-y-3">
        {logs.map((log) => (
          <article key={log.id} className="rounded-lg border border-border bg-surface p-4 shadow-low">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary">
                  {log.action} · {log.entityType}
                </p>
                {log.entityId ? (
                  <p className="mt-0.5 break-all font-mono text-xs text-text-tertiary">
                    {log.entityId}
                  </p>
                ) : null}
              </div>
              <time
                dateTime={log.createdAt.toISOString()}
                className="whitespace-nowrap text-xs tabular-nums text-text-tertiary"
              >
                {log.createdAt.toLocaleString("en-GB")}
              </time>
            </div>
            <p className="mt-2 text-xs text-text-secondary">Admin {log.adminId}</p>
            {log.details ? (
              <pre className="mt-3 overflow-x-auto rounded-md bg-canvas p-3 text-xs text-text-tertiary">
                {JSON.stringify(log.details, null, 2)}
              </pre>
            ) : null}
          </article>
        ))}
        {logs.length === 0 ? (
          <AdminEmptyState
            title="No audit entries found"
            description="No administrative actions match the current filters."
          />
        ) : null}
      </div>
      <AdminPager
        page={page}
        totalPages={totalPages}
        hrefForPage={(nextPage) =>
          `/admin/audit?${filterQuery}${filterQuery ? "&" : ""}page=${nextPage}`
        }
      />
    </>
  );
}
