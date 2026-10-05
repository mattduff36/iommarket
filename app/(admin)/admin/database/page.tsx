export const dynamic = "force-dynamic";
export const maxDuration = 300;

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadDatabaseSyncPreflight, loadDatabaseSyncRuns } from "@/actions/admin/database-sync";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { isStagingOnlyFeatureEnabled } from "@/lib/deployment/environment";
import { DatabaseInspection } from "./database-inspection";
import { DatabasePanel } from "./database-panel";

export const metadata: Metadata = { title: "Database | Admin" };

export default async function DatabasePage() {
  if (!isStagingOnlyFeatureEnabled()) notFound();
  const [result, history] = await Promise.all([
    loadDatabaseSyncPreflight(),
    loadDatabaseSyncRuns(),
  ]);
  if ("error" in result) notFound();
  const report = result.data;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Database"
        description="Compare production and development, then review and apply changes to development only."
      />
      <DatabaseInspection initialReport={report} />
      <DatabasePanel initialRuns={"data" in history ? history.data ?? [] : []} historyError={"error" in history ? history.error : undefined} />
    </div>
  );
}
