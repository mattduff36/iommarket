"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/cn";

interface DealerLogoProps {
  logoUrl: string | null;
  dealerName: string;
  className?: string;
  imageClassName?: string;
}

export function DealerLogo({
  logoUrl,
  dealerName,
  className,
  imageClassName,
}: DealerLogoProps) {
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const hasUsableLogo = Boolean(logoUrl && failedLogoUrl !== logoUrl);

  return (
    <div
      className={cn(
        "relative flex aspect-square shrink-0 items-center justify-center overflow-hidden bg-neon-blue-500/10 text-xl font-bold text-neon-blue-400",
        className,
      )}
    >
      {hasUsableLogo && logoUrl ? (
        isOptimizedDealerLogoUrl(logoUrl) ? (
          <Image
            src={logoUrl}
            alt={`${dealerName} logo`}
            fill
            sizes="(max-width: 640px) 96px, 128px"
            className={cn("object-contain p-1.5", imageClassName)}
            onError={() => setFailedLogoUrl(logoUrl)}
          />
        ) : (
          // Legacy external logos cannot be optimized safely without permitting arbitrary hosts.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt={`${dealerName} logo`}
            className={cn("h-full w-full object-contain p-1.5", imageClassName)}
            onError={() => setFailedLogoUrl(logoUrl)}
          />
        )
      ) : (
        <span aria-label={`No logo for ${dealerName}`}>{dealerName.charAt(0).toUpperCase() || "?"}</span>
      )}
    </div>
  );
}

function isOptimizedDealerLogoUrl(url: string) {
  try {
    const parsedUrl = new URL(url);
    return (
      parsedUrl.protocol === "https:" &&
      parsedUrl.hostname.endsWith(".supabase.co") &&
      parsedUrl.pathname.includes("/storage/v1/object/public/user-avatars/")
    );
  } catch {
    return false;
  }
}
