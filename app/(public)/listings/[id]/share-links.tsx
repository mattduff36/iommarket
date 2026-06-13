"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ShareLinksProps {
  url: string;
  title: string;
  text: string;
}

export function ShareLinks({ url, title, text }: ShareLinksProps) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [canNativeShare, setCanNativeShare] = useState(false);
  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(text);

  useEffect(() => {
    setCanNativeShare(Boolean(navigator.share));
  }, []);

  async function handleNativeShare() {
    if (!navigator.share) return;
    await navigator.share({ title, text, url });
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  return (
    <div className="space-y-4">
      <a
        className="group flex items-center gap-3 rounded-xl border border-[#1877F2]/30 bg-[#1877F2]/10 px-4 py-3 text-sm font-semibold text-white transition hover:border-[#1877F2]/70 hover:bg-[#1877F2]/20"
        href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedText}`}
        target="_blank"
        rel="noreferrer"
      >
        <FacebookLogo />
        <span>Share on Facebook</span>
      </a>
      <a
        className="group flex items-center gap-3 rounded-xl border border-white/20 bg-white/[0.08] px-4 py-3 text-sm font-semibold text-white transition hover:border-white/50 hover:bg-white/[0.12]"
        href={`https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`}
        target="_blank"
        rel="noreferrer"
      >
        <XLogo />
        <span>Post on X</span>
      </a>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {canNativeShare ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void handleNativeShare()}
            leftIcon={<Share2 className="h-4 w-4" />}
            className="w-full rounded-lg border border-border bg-surface-elevated"
          >
            Share
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => void handleCopyLink()}
          leftIcon={copyStatus === "copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          className="w-full rounded-lg border border-border bg-surface-elevated"
        >
          {copyStatus === "copied" ? "Copied" : "Copy link"}
        </Button>
      </div>
      {copyStatus === "copied" ? (
        <p className="text-xs text-neon-blue-400">Listing link copied.</p>
      ) : null}
      {copyStatus === "failed" ? (
        <p className="text-xs text-text-error">Could not copy the link. Please copy it from the address bar.</p>
      ) : null}
    </div>
  );
}

function FacebookLogo() {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1877F2] text-white shadow-[0_0_18px_rgba(24,119,242,0.35)]">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-current">
        <path d="M22 12.061C22 6.505 17.523 2 12 2S2 6.505 2 12.061c0 5.023 3.657 9.184 8.438 9.939v-7.03H7.898v-2.909h2.54V9.845c0-2.522 1.493-3.916 3.777-3.916 1.094 0 2.238.196 2.238.196v2.475h-1.261c-1.243 0-1.63.776-1.63 1.571v1.89h2.773l-.443 2.909h-2.33V22C18.343 21.245 22 17.084 22 12.061z" />
      </svg>
      <span className="sr-only">Facebook</span>
    </span>
  );
}

function XLogo() {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black shadow-[0_0_18px_rgba(255,255,255,0.18)]">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-current">
        <path d="M18.244 2H21.5l-7.11 8.129L22.75 22h-6.545l-5.127-6.701L5.21 22H1.952l7.606-8.696L1.54 2h6.71l4.633 6.124L18.244 2Zm-1.142 17.91h1.804L7.27 3.98H5.334L17.102 19.91Z" />
      </svg>
      <span className="sr-only">X</span>
    </span>
  );
}
