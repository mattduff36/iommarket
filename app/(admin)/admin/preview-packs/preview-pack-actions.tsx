"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { disablePreviewPack, enablePreviewPack } from "@/actions/admin/preview-packs";
import { Switch } from "@/components/ui/switch";

interface Props {
  dealerKey: string;
  displayName: string;
  enabled: boolean;
  materialized: boolean;
}

export function PreviewPackActions({
  dealerKey,
  displayName,
  enabled,
  materialized,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle(nextEnabled: boolean) {
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
    : materialized
      ? "Off"
      : "Off — first on uploads photos";

  return (
    <div className="flex flex-col items-end gap-1">
      <Switch
        checked={enabled}
        disabled={isPending}
        onCheckedChange={handleToggle}
        label={isPending ? (enabled ? "Hiding…" : "Enabling…") : label}
        aria-label={`${enabled ? "Hide" : "Show"} ${displayName} preview pack`}
      />
      {error ? <p className="max-w-xs text-right text-xs text-text-error">{error}</p> : null}
    </div>
  );
}
