export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { stockSyncStatus, stockSyncReason } from "@/lib/dealer-stock-sync/review";
import { requireRole } from "@/lib/auth";
import { getDealerStockSyncAvailability } from "@/lib/deployment/dealer-stock-sync";
import { db } from "@/lib/db";
import type { PlanAction } from "@/lib/dealer-stock-sync/types";
import { StockBindingForm } from "./binding-form";
import { StockSyncReviewPanel } from "./review-panel";

export const metadata: Metadata = { title: "Website stock sync | Admin" };

function asActions(plan: unknown): PlanAction[] {
  if (!plan || typeof plan !== "object" || !("actions" in plan)) return [];
  const actions = (plan as { actions?: unknown }).actions;
  return Array.isArray(actions) ? (actions as PlanAction[]) : [];
}

export default async function DealerStockSyncPage({
  params,
}: {
  params: Promise<{ dealerId: string }>;
}) {
  await requireRole("ADMIN");
  const availability = getDealerStockSyncAvailability();
  if (!availability.enabled) return <div role="status">{availability.reason}</div>;
  const { dealerId } = await params;
  const dealer = await db.dealerProfile.findUnique({
    where: { id: dealerId },
    select: {
      id: true,
      name: true,
      isAdminPreview: true,
      stockSourceBinding: {
        select: {
          registryKey: true,
          enabled: true,
          verifiedAt: true,
          jobs: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, error: true, createdAt: true } },
          reports: {
            orderBy: { createdAt: "desc" },
            take: 8,
            select: {
              id: true,
              status: true,
              fingerprint: true,
              failureReason: true,
              inventoryCount: true,
              plan: true,
              createdAt: true,
            },
          },
        },
      },
      user: { select: { role: true, disabledAt: true, deletedAt: true } },
    },
  });
  if (!dealer || dealer.isAdminPreview || dealer.user.role !== "DEALER" || dealer.user.deletedAt) {
    notFound();
  }
  const binding = dealer.stockSourceBinding;
  const latest = binding?.reports[0] ?? null;

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title={`Website stock · ${dealer.name}`}
        description="Check the dealer website and review additions, price changes and vehicles no longer advertised. Listings change only after approval."
        actions={
          <Link href="/admin/dealers" className="text-sm text-neon-blue-400 hover:underline">
            Back to dealers
          </Link>
        }
      />
      <p className="max-w-3xl rounded-md border border-border bg-surface-secondary px-4 py-3 text-sm text-text-secondary">
        Weekly checks run Friday at 06:00 UK time when processing is active. Changes always wait for approval. Vehicles missing from two complete checks are proposed for removal.
      </p>
      {binding?.jobs[0] ? <p className="text-sm text-text-secondary" role="status">
        Latest job: {stockSyncStatus(binding.jobs[0].status)}. {binding.jobs[0].error}
      </p> : null}
      <StockBindingForm
        dealerId={dealer.id}
        registryKey={binding?.registryKey ?? null}
        enabled={binding?.enabled ?? false}
        verified={Boolean(binding?.verifiedAt)}
      />
      {latest ? (
        <StockSyncReviewPanel
          reportId={latest.id}
          status={latest.status}
          fingerprint={latest.fingerprint}
          failureReason={latest.failureReason}
          actions={asActions(latest.plan)}
        />
      ) : (
        <p className="text-sm text-text-tertiary">No scrape reports yet.</p>
      )}
      {binding && binding.reports.length > 0 ? (
        <section>
          <h2 className="mb-2 text-lg font-semibold text-text-primary">Run history</h2>
          <ul className="space-y-1 text-sm text-text-secondary">
            {binding.reports.map((report) => (
              <li key={report.id}>
                {report.createdAt.toLocaleString("en-GB", { timeZone: "Europe/London" })} · {stockSyncStatus(report.status)} ·{" "}
                {report.inventoryCount} vehicles
                {report.failureReason ? ` · ${stockSyncReason(report.failureReason)}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
