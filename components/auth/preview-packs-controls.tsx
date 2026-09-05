"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { disablePreviewPack, enablePreviewPack } from "@/actions/admin/preview-packs";
import {
  getPreviewControls,
  setSampleListingVisibility,
} from "@/actions/admin/preview-controls";
import { cn } from "@/lib/cn";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

export interface PreviewPackControlRow {
  dealerKey: string;
  displayName: string;
  enabled: boolean;
  listingCount: number;
}

export interface PreviewControlsState {
  packs: PreviewPackControlRow[];
  samplePrivateVisible: boolean;
  sampleDealerVisible: boolean;
}

type PendingKey = "private" | "dealer" | string | null;

export async function loadPreviewControls() {
  const result = await getPreviewControls();
  if (!("data" in result) || !result.data) return null;
  return result.data;
}

export function usePreviewControls() {
  const router = useRouter();
  const [state, setState] = useState<PreviewControlsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<PendingKey>(null);
  const [isPending, startTransition] = useTransition();

  async function ensureLoaded() {
    if (state) return;
    const next = await loadPreviewControls();
    if (!next) {
      setError("Could not load preview controls.");
      return;
    }
    setState(next);
    setError(null);
  }

  function togglePack(pack: PreviewPackControlRow) {
    setError(null);
    setPendingKey(pack.dealerKey);
    startTransition(async () => {
      const result = pack.enabled
        ? await disablePreviewPack({ dealerKey: pack.dealerKey })
        : await enablePreviewPack({ dealerKey: pack.dealerKey });
      setPendingKey(null);
      if ("error" in result && result.error) {
        setError(typeof result.error === "string" ? result.error : "Failed");
        return;
      }
      setState((current) =>
        current
          ? {
              ...current,
              packs: current.packs.map((row) =>
                row.dealerKey === pack.dealerKey ? { ...row, enabled: !row.enabled } : row,
              ),
            }
          : current,
      );
      router.refresh();
    });
  }

  function toggleSample(kind: "private" | "dealer") {
    if (!state) return;
    const visible = kind === "private" ? !state.samplePrivateVisible : !state.sampleDealerVisible;
    setError(null);
    setPendingKey(kind);
    startTransition(async () => {
      const result = await setSampleListingVisibility({ kind, visible });
      setPendingKey(null);
      if ("error" in result && result.error) {
        setError(result.error);
        return;
      }
      setState((current) =>
        current
          ? {
              ...current,
              samplePrivateVisible:
                kind === "private" ? visible : current.samplePrivateVisible,
              sampleDealerVisible:
                kind === "dealer" ? visible : current.sampleDealerVisible,
            }
          : current,
      );
      router.refresh();
    });
  }

  return {
    state,
    error,
    pendingKey: isPending ? pendingKey : null,
    ensureLoaded,
    togglePack,
    toggleSample,
  };
}

function StatusMark({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <Check className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
  ) : (
    <X className="h-4 w-4 shrink-0 text-red-400" aria-hidden />
  );
}

export function PreviewPacksControlList({
  state,
  error,
  pendingKey,
  onTogglePack,
  onToggleSample,
  itemClassName,
  asMenuItems = false,
}: {
  state: PreviewControlsState | null;
  error: string | null;
  pendingKey: PendingKey;
  onTogglePack: (pack: PreviewPackControlRow) => void;
  onToggleSample: (kind: "private" | "dealer") => void;
  itemClassName?: string;
  asMenuItems?: boolean;
}) {
  if (!state) {
    return (
      <p className="px-2 py-2 text-xs text-text-tertiary">
        {error ?? "Loading preview packs…"}
      </p>
    );
  }

  const samples = [
    {
      key: "private" as const,
      label: "Private sample listings",
      enabled: state.samplePrivateVisible,
    },
    {
      key: "dealer" as const,
      label: "Dealer sample listings",
      enabled: state.sampleDealerVisible,
    },
  ];

  const rowClassName = cn(
    "flex w-full items-center gap-2 px-2 py-2 text-left text-sm text-text-primary",
    "hover:bg-surface-elevated disabled:opacity-60",
    "hover:outline hover:outline-2 hover:outline-offset-2 hover:outline-neon-blue-500",
    "data-[highlighted]:outline data-[highlighted]:outline-2 data-[highlighted]:outline-offset-2 data-[highlighted]:outline-neon-blue-500",
    itemClassName,
  );

  function renderRow(key: string, label: string, enabled: boolean, onSelect: () => void) {
    const body = (
      <>
        <StatusMark enabled={enabled} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </>
    );
    if (asMenuItems) {
      return (
        <DropdownMenuItem
          key={key}
          disabled={pendingKey !== null}
          onSelect={onSelect}
          className={rowClassName}
        >
          {body}
        </DropdownMenuItem>
      );
    }
    return (
      <button
        key={key}
        type="button"
        disabled={pendingKey !== null}
        onClick={onSelect}
        className={rowClassName}
      >
        {body}
      </button>
    );
  }

  return (
    <div className="flex flex-col">
      {samples.map((row) => renderRow(row.key, row.label, row.enabled, () => onToggleSample(row.key)))}
      <div className="my-1 h-px bg-border" />
      {state.packs.map((pack) =>
        renderRow(pack.dealerKey, pack.displayName, pack.enabled, () => onTogglePack(pack)),
      )}
      {state.packs.length > 0 ? null : (
        <p className="px-2 py-2 text-xs text-text-tertiary">No loaded preview packs.</p>
      )}
      {error ? <p className="px-2 py-1 text-xs text-text-error">{error}</p> : null}
    </div>
  );
}

export function PreviewPacksMobileExpander() {
  const [open, setOpen] = useState(false);
  const controls = usePreviewControls();

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void controls.ensureLoaded();
        }}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-sm font-medium rounded-sm text-red-400 hover:text-red-300 hover:bg-surface-elevated transition-colors"
      >
        <span className="flex-1 text-left">Preview packs</span>
        <span aria-hidden>{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div className="max-h-80 overflow-y-auto pb-2">
          <PreviewPacksControlList
            state={controls.state}
            error={controls.error}
            pendingKey={controls.pendingKey}
            onTogglePack={controls.togglePack}
            onToggleSample={controls.toggleSample}
            itemClassName="px-3"
          />
        </div>
      ) : null}
    </div>
  );
}
