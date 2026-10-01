export const dynamic = "force-dynamic";
export const maxDuration = 180;

import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { isCostOwner, isCostsEnabled } from "@/lib/costs/config";
import { getCostDashboard } from "@/lib/costs/queries";
import { costDb } from "@/lib/costs/db";
import { resolveLedgerAccess } from "@/lib/costs/ledger-access";
import { fetchRemoteCostDashboard } from "@/lib/costs/remote-ledger";
import { DEFAULT_MANUAL_COST_CATEGORIES } from "@/lib/costs/manual-categories";
import type { CostDashboardDto } from "@/lib/costs/dto";
import { CostDashboardView } from "./cost-dashboard";
import { syncAccountsPreview } from "@/lib/costs/accounts-projection";

export const metadata: Metadata = { title: "Costs | Admin" };

function unavailableDashboard(reason: string, isOwner: boolean): CostDashboardDto {
  return {
    enabled: true,
    startedAt: null,
    isOwner,
    projectedTotalLabel: "Unavailable",
    projectedTotalMinor: 0,
    invoiceableTotalLabel: "Unavailable",
    invoiceableTotalMinor: 0,
    requestButtonLabel: "Invoice request unavailable",
    canRequestInvoice: false,
    pendingRequest: null,
    sections: [],
    requests: [],
    sync: {
      status: "NONE",
      stale: true,
      quarantinedCount: 0,
      completedAt: null,
      errorCode: null,
    },
    unavailableReason: reason,
    affectsLiveLedger: false,
    ledgerRevision: null,
    ledgerAsOf: null,
    manualCategories: [...DEFAULT_MANUAL_COST_CATEGORIES],
  };
}

export default async function AdminCostsPage() {
  const admin = await requireRole("ADMIN");
  const enabled = isCostsEnabled();
  const isOwner = isCostOwner(admin.authUserId);
  const access = resolveLedgerAccess();

  if (!enabled) {
    const dashboard = await getCostDashboard({ db: costDb, enabled: false, isOwner });
    return <CostDashboardView dashboard={dashboard} />;
  }

  if (access.mode === "unavailable") {
    return <CostDashboardView dashboard={unavailableDashboard(access.reason, isOwner)} />;
  }
  if(access.mode==="accounts-preview"){
    let dashboard: CostDashboardDto;
    try{
      const accountsSnapshot=await syncAccountsPreview();
      dashboard=await getCostDashboard({db:costDb,enabled,isOwner,accountsSnapshot});
    }catch{dashboard=unavailableDashboard("The isolated Accounts preview could not be refreshed. Existing local records are retained; no live ledger was changed.",isOwner);}
    return <CostDashboardView dashboard={dashboard}/>;
  }

  if (access.mode === "remote") {
    let dashboard: CostDashboardDto;
    try {
      dashboard = await fetchRemoteCostDashboard(access.origin);
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : "The canonical ledger is unavailable.";
      dashboard = unavailableDashboard(reason, isOwner);
    }
    return (
      <CostDashboardView
        dashboard={{
          ...dashboard,
          isOwner,
          affectsLiveLedger: true,
          manualCategories: dashboard.manualCategories?.length
            ? dashboard.manualCategories
            : [...DEFAULT_MANUAL_COST_CATEGORIES],
        }}
      />
    );
  }

  const dashboard = await getCostDashboard({
    db: costDb,
    enabled,
    isOwner,
  });

  return <CostDashboardView dashboard={dashboard} />;
}
