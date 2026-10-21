export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "@/components/navigation/link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { stockSyncStatus } from "@/lib/dealer-stock-sync/review";
import type { PlanAction } from "@/lib/dealer-stock-sync/types";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Stock reviews | Admin" };

function actionsOf(plan: unknown): PlanAction[] {
  if (!plan || typeof plan !== "object" || !("actions" in plan)) return [];
  const actions = (plan as { actions?: unknown }).actions;
  return Array.isArray(actions) ? (actions as PlanAction[]) : [];
}

function warningOf(plan: unknown) {
  if (!plan || typeof plan !== "object" || !("reviewSource" in plan)) return null;
  const source = (plan as { reviewSource?: { coverageWarning?: unknown; capacityWarning?: unknown } }).reviewSource;
  if (!source) return null;
  return {
    coverageWarning: typeof source.coverageWarning === "string" ? source.coverageWarning : null,
    capacityWarning: typeof source.capacityWarning === "string" ? source.capacityWarning : null,
  };
}

export default async function AdminStockReviewsPage() {
  await requireRole("ADMIN");
  const reports = await db.dealerStockSyncReport.findMany({
    where: { status: { in: ["PENDING_REVIEW", "APPROVED"] } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      dealerId: true,
      inventoryCount: true,
      createdAt: true,
      plan: true,
      binding: { select: { registryKey: true, dealer: { select: { id: true, name: true } } } },
    },
  });
  const groups = new Map<string, { dealerId: string; name: string; reports: typeof reports }>();
  for (const report of reports) {
    const dealerId = report.binding.dealer.id;
    const current = groups.get(dealerId) ?? { dealerId, name: report.binding.dealer.name, reports: [] };
    groups.set(dealerId, { ...current, reports: [...current.reports, report] });
  }
  const dealers = [...groups.values()].sort((left, right) => left.name.localeCompare(right.name));

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Stock reviews"
        description="Pending and approved website-stock reviews. Approval queues processing and does not publish listings immediately."
      />
      {dealers.length === 0 ? (
        <p className="text-sm text-text-tertiary">No pending or approved stock reviews.</p>
      ) : (
        dealers.map((dealer) => (
          <section key={dealer.dealerId} className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">
              <Link href={`/admin/dealers/${dealer.dealerId}/stock-sync`} className="hover:underline">
                {dealer.name}
              </Link>
            </h2>
            <ul className="space-y-2">
              {dealer.reports.map((report) => {
                const actions = actionsOf(report.plan);
                const warning = warningOf(report.plan);
                const actionable = actions.filter((action) => action.kind === "create" || action.kind === "update").length;
                const blocked = actions.filter((action) => action.kind === "blocked" || action.kind === "conflict").length;
                return (
                  <li key={report.id} className="rounded-md border border-border px-4 py-3 text-sm">
                    <p className="font-medium text-text-primary">
                      {stockSyncStatus(report.status)} · {report.inventoryCount} vehicles
                    </p>
                    <p className="text-text-secondary">
                      {actionable} actionable · {blocked} blocked or sold · {report.createdAt.toLocaleString("en-GB", { timeZone: "Europe/London" })}
                    </p>
                    {warning?.coverageWarning ? <p className="text-text-secondary">{warning.coverageWarning}</p> : null}
                    {warning?.capacityWarning ? <p className="text-text-secondary">{warning.capacityWarning}</p> : null}
                    <Link href={`/admin/dealers/${dealer.dealerId}/stock-sync`} className="text-neon-blue-400 hover:underline">
                      Open dealer stock review
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
