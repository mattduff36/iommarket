import * as React from "react";
import { cn } from "@/lib/cn";
import { PackageOpen } from "lucide-react";

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-12 text-center",
        className,
      )}
      {...props}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-elevated text-text-secondary">
        {icon ?? <PackageOpen className="h-6 w-6" />}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-text-primary">{title}</h3>
        {description && (
          <p className="max-w-sm text-sm text-text-secondary">{description}</p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export { EmptyState };
