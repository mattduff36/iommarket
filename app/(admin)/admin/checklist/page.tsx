export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { loadChecklist } from "@/actions/admin/checklist";
import { createDefaultChecklistItems } from "@/lib/admin/checklist";
import { ChecklistBoard } from "./checklist-board";

export const metadata: Metadata = { title: "Checklist | Admin" };

export default async function AdminChecklistPage() {
  const result = await loadChecklist();
  const items = result.data ?? createDefaultChecklistItems();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-text-primary">Checklist</h1>
      <p className="mt-1 mb-6 text-sm text-text-secondary">
        Shared admin to-do list. Check items off as they are done, add notes, or
        capture new work. Everyone with admin access sees the same list.
      </p>
      {result.error ? (
        <p className="mb-4 text-sm text-text-error">{result.error}</p>
      ) : null}
      <ChecklistBoard initialItems={items} />
    </div>
  );
}
