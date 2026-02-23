"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant={active ? "ghost" : "energy"}
        onClick={handleToggle}
        disabled={isPending}
        className="text-xs"
      >
        {active ? "Disable" : "Enable"}
      </Button>

      {!hasReferences && (
        <>
          {!showDelete ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowDelete(true)}
              disabled={isPending}
              className="text-xs text-neon-red-400"
            >
              Delete
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={handleDelete} disabled={isPending} className="text-xs text-neon-red-400">
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowDelete(false)} disabled={isPending} className="text-xs">
                Cancel
              </Button>
            </>
          )}
        </>
      )}

      {error && <span className="text-xs text-text-error">{error}</span>}
    </div>
  );
}
