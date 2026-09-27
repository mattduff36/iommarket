import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

interface AdminFilterBarProps {
  children: ReactNode;
  count?: ReactNode;
  label?: string;
  className?: string;
}

export function AdminFilterBar({
  children,
  count,
  label = "Filters",
  className,
}: AdminFilterBarProps) {
  return (
    <section
      aria-label={label}
      className={cn(
        "mb-6 flex flex-col gap-3 rounded-lg border border-border bg-surface/70 p-3 shadow-low sm:flex-row sm:flex-wrap sm:items-center",
        className,
      )}
    >
      {children}
      {count ? (
        <div className="text-xs tabular-nums text-text-tertiary sm:ml-auto">
          {count}
        </div>
      ) : null}
    </section>
  );
}

interface AdminFilterChipProps {
  href: string;
  children: ReactNode;
  active?: boolean;
  activeTone?: "neutral" | "success" | "warning";
  className?: string;
}

const activeToneClass = {
  neutral: "border-border-focus bg-surface-elevated text-text-primary",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  warning:
    "border-premium-gold-500/30 bg-premium-gold-500/10 text-premium-gold-400",
};

export function AdminFilterChip({
  href,
  children,
  active = false,
  activeTone = "neutral",
  className,
}: AdminFilterChipProps) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-md border px-3 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        active
          ? activeToneClass[activeTone]
          : "border-transparent text-text-secondary hover:border-border hover:bg-surface-elevated hover:text-text-primary",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export const adminSearchInputClass =
  "h-9 min-w-0 flex-1 rounded-md border border-border bg-canvas px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-neon-blue-500/20 sm:w-64 sm:flex-none";

export const adminSearchButtonClass =
  "inline-flex h-9 items-center justify-center rounded-md border border-border bg-surface-elevated px-3 text-sm font-medium text-text-primary transition-colors hover:border-border-focus hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";
