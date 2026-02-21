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
            "flex h-10 w-full rounded-sm border border-border bg-surface-elevated px-3 py-2 text-sm text-text-primary",
            "placeholder:text-text-secondary",
            "transition-all duration-fast ease-fast",
            "focus:outline-none focus:border-neon-blue-500 focus:shadow-glow-blue",
            "disabled:cursor-not-allowed disabled:opacity-50",
            hasError && "border-neon-red-500 focus:border-neon-red-500 focus:shadow-glow-red",
            className,
          )}
          {...props}
        />
        {(error || helperText) && (
          <p
            id={helperId}
            className={cn(
              "text-xs",
              hasError ? "text-text-energy" : "text-text-secondary",
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
