"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
    label?: React.ReactNode;
    error?: string;
  }
>(({ className, label, id, error, ...props }, ref) => {
  const generatedId = React.useId();
  const checkboxId = id || generatedId;
  const errorId = `${checkboxId}-error`;
  const hasError = Boolean(error);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-2.5">
        <CheckboxPrimitive.Root
          ref={ref}
          id={checkboxId}
          {...props}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? errorId : undefined}
          className={cn(
            "mt-0.5 peer h-5 w-5 shrink-0 rounded-sm border-2 border-text-secondary bg-surface-elevated",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "data-[state=checked]:bg-neon-blue-500 data-[state=checked]:border-neon-blue-500 data-[state=checked]:text-white",
            hasError && "border-neon-red-500",
            className,
          )}
        >
          <CheckboxPrimitive.Indicator className="flex items-center justify-center">
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
        {label && (
          <label
            htmlFor={checkboxId}
            className="text-sm text-text-primary cursor-pointer select-none leading-snug peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            {label}
            {props.required ? (
              <span aria-hidden="true" className="text-text-error">
                {" "}*
              </span>
            ) : null}
          </label>
        )}
      </div>
      {error ? (
        <p id={errorId} className="text-xs text-text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
});
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
