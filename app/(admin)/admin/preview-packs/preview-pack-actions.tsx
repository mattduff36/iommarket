"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { disablePreviewPack, enablePreviewPack } from "@/actions/admin/preview-packs";
import { Switch } from "@/components/ui/switch";

interface Props {
  dealerKey: string;
  displayName: string;
  enabled: boolean;
  loaded: boolean;
  materialized: boolean;
  archiveAvailable: boolean;
}

export function PreviewPackActions({
  dealerKey,
  displayName,
  enabled,
  loaded,
  materialized,
  archiveAvailable,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canToggle = loaded || archiveAvailable;

  function handleToggle(nextEnabled: boolean) {
    if (!canToggle) return;
    setError(null);
    startTransition(async () => {
      const result = nextEnabled
        ? await enablePreviewPack({ dealerKey })
        : await disablePreviewPack({ dealerKey });
      if ("error" in result && result.error) {
        setError(typeof result.error === "string" ? result.error : "Failed");
        return;
      }
      router.refresh();
    });
  }

  const label = enabled
    ? "On"
    : loaded
      ? "Off"
      : archiveAvailable
        ? "Off — first on uploads photos"
        : "Not loaded here";

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-2">
        <span className={`text-right text-sm text-text-primary ${canToggle ? "" : "opacity-70"}`}>
          {isPending ? (enabled ? "Hiding…" : "Enabling…") : label}
        </span>
        <Switch
          checked={enabled}
          disabled={isPending || !canToggle}
          onCheckedChange={handleToggle}
          aria-label={`${enabled ? "Hide" : "Show"} ${displayName} preview pack`}
        />
      </div>
      {error ? <p className="max-w-xs text-right text-xs text-text-error">{error}</p> : null}
      {!loaded && !materialized && !archiveAvailable ? (
        <p className="max-w-xs text-right text-xs text-text-tertiary">
          Load once from local preview, then toggle here.
        </p>
      ) : null}
    </div>
  );
}
