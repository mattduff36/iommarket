import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface AdminDataCellProps {
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  className?: string;
}

export function AdminDataCell({
  title,
  subtitle,
  badges,
  className,
}: AdminDataCellProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <div className="min-w-0 font-medium text-text-primary">{title}</div>
        {badges}
      </div>
      {subtitle ? (
        <div className="mt-0.5 min-w-0 text-xs leading-5 text-text-tertiary">
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}
