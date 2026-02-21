"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & { label?: string }
>(({ className, label, id, ...props }, ref) => {
  const checkboxId = id || React.useId();

  return (
    <div className="flex items-center gap-2">
      <CheckboxPrimitive.Root
        ref={ref}
        id={checkboxId}
        className={cn(
          "peer h-4 w-4 shrink-0 rounded-sm border border-border bg-surface",
          "focus-visible:outline-none focus-visible:shadow-outline",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "data-[state=checked]:bg-neon-blue-500 data-[state=checked]:border-neon-blue-500 data-[state=checked]:text-white",
          className,
        )}
        {...props}
      >
        <CheckboxPrimitive.Indicator className="flex items-center justify-center">
          <Check className="h-3 w-3" strokeWidth={3} />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label && (
        <label
          htmlFor={checkboxId}
          className="text-sm text-text-primary cursor-pointer select-none leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
        >
          {label}
        </label>
      )}
    </div>
  );
});
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
