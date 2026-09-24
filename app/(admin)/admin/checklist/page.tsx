export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { loadChecklist } from "@/actions/admin/checklist";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { ChecklistBoard } from "./checklist-board";

export const metadata: Metadata = { title: "Checklist | Admin" };

export default async function AdminChecklistPage() {
  const result = await loadChecklist();

  return (
    <div className="mx-auto max-w-3xl">
      <AdminPageHeader
        title="Checklist"
        description="Shared admin to-do list. Check items off as they are done, add notes, or capture new work. Everyone with admin access sees the same list."
      />
      {result.error || !result.data ? (
        <p className="rounded-lg border border-neon-red-500/20 bg-neon-red-500/5 p-4 text-sm text-text-error">
          {result.error}
        </p>
      ) : (
        <ChecklistBoard
          initialItems={result.data.items}
          initialUpdatedAt={result.data.updatedAt}
        />
      )}
    </div>
  );
}
