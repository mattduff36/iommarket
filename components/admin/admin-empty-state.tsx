import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface AdminEmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

export function AdminEmptyState({
  title,
  description,
  icon: Icon,
  action,
  compact = false,
  className,
}: AdminEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-canvas/35 px-5 text-center",
        compact ? "min-h-28 py-6" : "min-h-48 py-10",
        className,
      )}
    >
      {Icon ? (
        <Icon className="mb-3 h-5 w-5 text-text-tertiary" aria-hidden="true" />
      ) : null}
      <p className="text-sm font-medium text-text-primary">{title}</p>
      {description ? (
        <p className="mt-1 max-w-md text-sm leading-6 text-text-secondary">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
