export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { isCostOwner, isCostsEnabled } from "@/lib/costs/config";
import { getCostDashboard } from "@/lib/costs/queries";
import { db } from "@/lib/db";
import { CostDashboardView } from "./cost-dashboard";

export const metadata: Metadata = { title: "Costs | Admin" };

export default async function AdminCostsPage() {
  const admin = await requireRole("ADMIN");
  const enabled = isCostsEnabled();
  const dashboard = await getCostDashboard({
    db,
    enabled,
    isOwner: isCostOwner(admin.authUserId),
  });

  return <CostDashboardView dashboard={dashboard} />;
}
