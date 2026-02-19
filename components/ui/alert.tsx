import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const alertVariants = cva(
  "relative flex gap-3 items-start rounded-md p-3 text-sm",
  {
    variants: {
      status: {
        success: "bg-status-success-bg text-status-success-text",
        error: "bg-status-error-bg text-status-error-text",
        info: "bg-status-info-bg text-status-info-text",
        warning: "bg-status-warning-bg text-status-warning-text",
      },
    },
    defaultVariants: {
      status: "info",
    },
  },
);

const iconMap = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: AlertCircle,
};

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  onClose?: () => void;
}

function Alert({ className, status, children, onClose, ...props }: AlertProps) {
  const Icon = iconMap[status ?? "info"];
  return (
    <div
      role="alert"
      className={cn(alertVariants({ status }), className)}
      {...props}
    >
      <Icon className="h-5 w-5 shrink-0 mt-0.5" />
      <div className="flex-1">{children}</div>
      {onClose && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="shrink-0 h-8 w-8 hover:opacity-70"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

export { Alert, alertVariants };
