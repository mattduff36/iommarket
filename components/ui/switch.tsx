"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/cn";

const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & { label?: string }
>(({ className, label, id, ...props }, ref) => {
  const switchId = id || React.useId();

  return (
    <div className="flex items-center gap-2">
      <SwitchPrimitive.Root
        id={switchId}
        ref={ref}
        className={cn(
          "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
          "focus-visible:outline-none focus-visible:shadow-outline",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "data-[state=checked]:bg-royal-700 data-[state=unchecked]:bg-slate-200",
          className,
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
            "data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
          )}
        />
      </SwitchPrimitive.Root>
      {label && (
        <label
          htmlFor={switchId}
          className="text-sm text-text-primary cursor-pointer select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
        >
          {label}
        </label>
      )}
    </div>
  );
});
Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };
