"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteSavedSearch } from "@/actions/user-tools";
import { AccountConfirmDialog } from "@/components/account/account-confirm-dialog";
import { AccountRowActions } from "@/components/account/account-row-actions";

interface SavedSearchActionsProps {
  savedSearchId: string;
  name?: string;
  href?: string;
}

function readableActionError(error: unknown) {
  if (typeof error === "string" && error.trim()) return error;
  return "Could not delete this saved search. Please try again.";
}

export function SavedSearchActions({
  savedSearchId,
  name = "this saved search",
  href,
}: SavedSearchActionsProps) {
  const router = useRouter();
  const submitLock = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function removeSearch() {
    if (submitLock.current) return;
    submitLock.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    void (async () => {
      try {
        const result = await deleteSavedSearch({ savedSearchId });
        if (result.error) {
          setConfirmOpen(false);
          setError(readableActionError(result.error));
          return;
        }
        setConfirmOpen(false);
        setNotice("Saved search removed.");
        router.refresh();
      } catch {
        setError("Could not delete this saved search. Please try again.");
      } finally {
        submitLock.current = false;
        setPending(false);
      }
    })();
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <AccountRowActions
        label={`Actions for ${name}`}
        pendingLabel={pending ? "Removing…" : undefined}
        actions={[
          ...(href
            ? [
                {
                  kind: "link" as const,
                  id: "open",
                  label: "Open search",
                  href,
                },
              ]
            : []),
          {
            kind: "command",
            id: "delete",
            label: "Delete",
            destructive: true,
            onSelect: () => setConfirmOpen(true),
          },
        ]}
      />
      {error ? (
        <p className="max-w-64 text-xs text-text-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="max-w-64 text-xs text-text-secondary" role="status">
          {notice}
        </p>
      ) : null}
      <AccountConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete saved search"
        description="Delete this saved search? You can save it again from search results."
        confirmLabel="Delete saved search"
        pendingLabel="Removing…"
        destructive
        pending={pending}
        onConfirm={removeSearch}
      />
    </div>
  );
}
