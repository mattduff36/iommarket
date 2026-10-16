import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPreviewMirrorStatus } from "@/actions/admin/preview-mirror";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { isStagingOnlyFeatureEnabled } from "@/lib/deployment/environment";
import { DatabasePanel } from "./database-panel";

export const metadata: Metadata = { title: "Preview refresh | Admin" };
export const runtime = "nodejs";
export const maxDuration = 300;

export default async function DatabasePage() {
  if (!isStagingOnlyFeatureEnabled()) notFound();
  const result = await loadPreviewMirrorStatus();

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Preview refresh" description="Refresh staging from the current production data." />
      <DatabasePanel initialStatus={result.data ?? null} initialStatusError={result.error} />
    </div>
  );
}
