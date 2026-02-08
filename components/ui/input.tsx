"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, helperText, error, id, type = "text", ...props }, ref) => {
    const inputId = id || React.useId();
    const helperId = `${inputId}-helper`;
    const hasError = Boolean(error);

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-text-primary"
          >
            {label}
          </label>
        )}
        <input
          type={type}
          id={inputId}
          ref={ref}
          aria-invalid={hasError || undefined}
          aria-describedby={helperText || error ? helperId : undefined}
          className={cn(
            "flex h-10 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary",
            "placeholder:text-text-tertiary",
            "focus:outline-none focus:border-border-focus focus:shadow-outline",
            "disabled:cursor-not-allowed disabled:opacity-50",
            hasError && "border-border-error bg-red-50 focus:border-border-error",
            className,
          )}
          {...props}
        />
        {(error || helperText) && (
          <p
            id={helperId}
            className={cn(
              "text-xs",
              hasError ? "text-text-error" : "text-text-secondary",
            )}
          >
            {error || helperText}
          </p>
        )}
      </div>
    );
  },
);
Input.displayName = "Input";

export { Input };
