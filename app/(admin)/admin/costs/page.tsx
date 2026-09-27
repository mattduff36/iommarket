export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { isCostOwner, isCostsEnabled } from "@/lib/costs/config";
import {
  COST_ALLOWANCE_LABEL,
  COST_CURSOR_POLICY_LABEL,
  COST_INFRASTRUCTURE_MARKUP_LABEL,
} from "@/lib/costs/copy";
import { getCostDashboard } from "@/lib/costs/queries";
import { costDb } from "@/lib/costs/db";
import { resolveLedgerAccess } from "@/lib/costs/ledger-access";
import { fetchRemoteCostDashboard } from "@/lib/costs/remote-ledger";
import type { CostDashboardDto } from "@/lib/costs/dto";
import { CostDashboardView } from "./cost-dashboard";

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
    infrastructureMarkupLabel: COST_INFRASTRUCTURE_MARKUP_LABEL,
    cursorPolicyLabel: COST_CURSOR_POLICY_LABEL,
    allowanceLabel: COST_ALLOWANCE_LABEL,
    affectsLiveLedger: false,
    ledgerRevision: null,
    ledgerAsOf: null,
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
        dashboard={{ ...dashboard, isOwner, affectsLiveLedger: true }}
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
