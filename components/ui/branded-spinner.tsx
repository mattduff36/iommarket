"use client";

import { cn } from "@/lib/cn";

interface BrandedSpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<BrandedSpinnerProps["size"]>, string> = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
};

export function BrandedSpinner({ size = "md", className }: BrandedSpinnerProps) {
  return (
    <span
      className={cn(
        "inline-block animate-spin rounded-full bg-center bg-contain bg-no-repeat",
        SIZE_CLASS[size],
        className
      )}
      style={{ backgroundImage: "url('/images/loop-logo.svg')" }}
      aria-hidden
    />
  );
}
