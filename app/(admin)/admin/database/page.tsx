export const dynamic = "force-dynamic";
export const maxDuration = 300;

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadDatabaseSyncPreflight, loadDatabaseSyncRuns } from "@/actions/admin/database-sync";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { isStagingOnlyFeatureEnabled } from "@/lib/deployment/environment";
import { DatabasePanel } from "./database-panel";

export const metadata: Metadata = { title: "Database | Admin" };

export default async function DatabasePage() {
  if (!isStagingOnlyFeatureEnabled()) notFound();
  const result = await loadDatabaseSyncPreflight();
  if ("error" in result) notFound();
  const report = result.data;
  const history = await loadDatabaseSyncRuns();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Database"
        description="Compare production and development, then review and apply changes to development only."
      />
      <div className="flex justify-end">
        <Link href="/admin/database" className="rounded-md border border-border px-3 py-2 text-sm text-text-primary hover:bg-surface-elevated">
          Refresh inspection
        </Link>
      </div>
      <section className="rounded-lg border border-border bg-surface p-5" aria-labelledby="db-readiness">
        <h2 id="db-readiness" className="text-lg font-semibold text-text-primary">Connection and schema readiness</h2>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-text-secondary">Production source</dt><dd className="font-medium text-text-primary">{report.source}</dd></div>
          <div><dt className="text-text-secondary">Development destination</dt><dd className="font-medium text-text-primary">{report.destination}</dd></div>
          <div><dt className="text-text-secondary">Source role</dt><dd className="font-medium text-text-primary">{report.sourceReadOnlyRole ? "Verified read-only" : "Not verified"}</dd></div>
          <div><dt className="text-text-secondary">Public tables</dt><dd className="font-medium text-text-primary">{report.sourceTables} production / {report.destinationTables} development</dd></div>
          <div><dt className="text-text-secondary">Table structure</dt><dd className="font-medium text-text-primary">{report.schemaCompatible ? "Matching" : "Unverified or different"}</dd></div>
          <div><dt className="text-text-secondary">Prisma migrations</dt><dd className="font-medium text-text-primary">{report.migrationsCompatible ? "Matching" : "Unverified or different"}</dd></div>
        </dl>
        {report.blockers.length > 0 ? (
          <div className="mt-5 rounded-md border border-neon-red-500/30 bg-neon-red-500/5 p-4">
            <h3 className="font-semibold text-text-primary">Inspection blockers</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-secondary">
              {report.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
            </ul>
          </div>
        ) : <p className="mt-5 text-sm text-text-secondary">Read-only inspection passed. Prepare a plan below to review the proposed changes.</p>}
      </section>
      {report.rows.length > 0 ? (
        <section className="overflow-x-auto rounded-lg border border-border bg-surface p-5" aria-labelledby="db-counts">
          <h2 id="db-counts" className="text-lg font-semibold text-text-primary">Selected table counts</h2>
          <p className="mt-1 text-sm text-text-secondary">Counts describe the current snapshot only. They do not approve a copy.</p>
          <table className="mt-4 w-full text-left text-sm">
            <thead><tr className="border-b border-border text-text-secondary"><th className="py-2">Table</th><th className="py-2 text-right">Production</th><th className="py-2 text-right">Development</th></tr></thead>
            <tbody>{report.rows.map((row) => (
              <tr key={row.table} className="border-b border-border/50 last:border-0">
                <th scope="row" className="py-2 font-medium text-text-primary">{row.table}</th>
                <td className="py-2 text-right tabular-nums">{row.production.toLocaleString()}</td>
                <td className="py-2 text-right tabular-nums">{row.development.toLocaleString()}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      ) : null}
      <DatabasePanel initialRuns={"data" in history ? history.data ?? [] : []} historyError={"error" in history ? history.error : undefined} />
    </div>
  );
}
