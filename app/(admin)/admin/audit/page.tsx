export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
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
    <div>
      <h1 className="text-2xl font-bold text-text-primary mb-6">Admin Audit</h1>
      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <input
          name="entityType"
          defaultValue={params.entityType ?? ""}
          placeholder="Entity type"
          className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
        />
        <input
          name="entityId"
          defaultValue={params.entityId ?? ""}
          placeholder="Entity ID"
          className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
        />
        <button type="submit" className="h-9 rounded-md border border-border px-3 text-sm">
          Filter
        </button>
      </form>
      <div className="space-y-3">
        {logs.map((log) => (
          <div key={log.id} className="rounded-lg border border-border bg-surface p-3">
            <p className="text-sm font-medium text-text-primary">
              {log.action} · {log.entityType}
              {log.entityId ? ` · ${log.entityId}` : ""}
            </p>
            <p className="text-xs text-text-secondary">
              {log.adminId} · {log.createdAt.toLocaleString("en-GB")}
            </p>
            {log.details ? (
              <pre className="mt-2 overflow-x-auto text-xs text-text-tertiary">
                {JSON.stringify(log.details, null, 2)}
              </pre>
            ) : null}
          </div>
        ))}
        {logs.length === 0 ? (
          <p className="text-sm text-text-secondary">No audit entries match this filter.</p>
        ) : null}
      </div>
      <AdminPager
        page={page}
        totalPages={totalPages}
        hrefForPage={(nextPage) =>
          `/admin/audit?${filterQuery}${filterQuery ? "&" : ""}page=${nextPage}`
        }
      />
    </div>
  );
}
