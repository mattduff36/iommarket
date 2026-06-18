"use client";

import { useMemo, useState, useTransition } from "react";
import {
  AdminActionBar,
  AdminActionButton,
  AdminActionTextarea,
} from "@/components/admin/admin-action-controls";
import { generateMonitoringCursorPrompt } from "@/actions/admin/monitoring";

interface Props {
  issueId: string;
  initialPrompt: string | null;
  generatedAt: string | null;
}

export function CursorPromptControls({ issueId, initialPrompt, generatedAt }: Props) {
  const [isPending, startTransition] = useTransition();
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generatedLabel = useMemo(() => {
    if (!generatedAt) return "No prompt generated yet";
    const date = new Date(generatedAt);
    if (Number.isNaN(date.getTime())) return "Prompt generated";
    return `Generated ${date.toLocaleString("en-GB")}`;
  }, [generatedAt]);

  function handleGenerate() {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const result = await generateMonitoringCursorPrompt({ issueId });
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Failed to generate prompt");
        return;
      }
      setPrompt(result.data?.prompt ?? "");
    });
  }

  async function handleCopy() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Clipboard copy failed. You can still copy manually from the textarea.");
    }
  }

  return (
    <div className="space-y-3">
      <AdminActionBar>
        <AdminActionButton
          onClick={handleGenerate}
          disabled={isPending}
          tone="primary"
        >
          Generate Cursor Prompt
        </AdminActionButton>
        <AdminActionButton
          onClick={handleCopy}
          disabled={!prompt}
        >
          {copied ? "Copied" : "Copy Prompt"}
        </AdminActionButton>
      </AdminActionBar>
      <p className="text-xs text-text-secondary">{generatedLabel}</p>
      <AdminActionTextarea
        readOnly
        value={prompt}
        className="h-64 w-full rounded-md border border-border bg-surface p-3 text-xs text-text-primary"
        placeholder="Generate a prompt to copy into Cursor."
      />
      {error && <p className="text-xs text-text-error">{error}</p>}
    </div>
  );
}
