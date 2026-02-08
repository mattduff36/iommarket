import * as React from "react";
import { cn } from "@/lib/cn";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Shape variant */
  variant?: "rectangle" | "circle" | "text";
}

function Skeleton({ className, variant = "rectangle", ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse bg-slate-200",
        variant === "circle" && "rounded-full",
        variant === "text" && "h-4 rounded-md",
        variant === "rectangle" && "rounded-lg",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
