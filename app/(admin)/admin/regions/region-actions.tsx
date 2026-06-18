"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AdminActionBar,
  AdminActionButton,
} from "@/components/admin/admin-action-controls";
import { toggleRegionActive, deleteRegion } from "@/actions/admin/regions";

interface RegionActionsProps {
  regionId: string;
  active: boolean;
  hasReferences: boolean;
}

export function RegionActions({ regionId, active, hasReferences }: RegionActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);

  function handleToggle() {
    setError(null);
    startTransition(async () => {
      const result = await toggleRegionActive(regionId, !active);
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Failed");
      } else {
        router.refresh();
      }
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteRegion(regionId);
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Failed");
      } else {
        router.refresh();
      }
    });
    setShowDelete(false);
  }

  return (
    <div className="space-y-2">
      <AdminActionBar>
        <AdminActionButton
          onClick={handleToggle}
          disabled={isPending}
          tone={active ? "neutral" : "success"}
        >
          {active ? "Disable" : "Enable"}
        </AdminActionButton>

        {!hasReferences && (
          <>
            {!showDelete ? (
              <AdminActionButton
                onClick={() => setShowDelete(true)}
                disabled={isPending}
                tone="danger"
              >
                Delete
              </AdminActionButton>
            ) : (
              <AdminActionBar className="rounded-lg border border-neon-red-500/20 bg-neon-red-500/5 p-1.5">
                <AdminActionButton onClick={handleDelete} disabled={isPending} tone="danger">
                  Confirm
                </AdminActionButton>
                <AdminActionButton onClick={() => setShowDelete(false)} disabled={isPending}>
                  Cancel
                </AdminActionButton>
              </AdminActionBar>
            )}
          </>
        )}
      </AdminActionBar>

      {error && <p className="text-xs text-text-error">{error}</p>}
    </div>
  );
}
