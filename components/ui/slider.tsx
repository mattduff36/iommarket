"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/cn";

interface SliderProps
  extends React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> {
  thumbLabels?: string[];
}

const Slider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  SliderProps
>(({ className, thumbLabels, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center py-2",
      className,
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-graphite-600">
      <SliderPrimitive.Range
        className="absolute h-full rounded-full transition-[width,left] duration-150 ease-out"
        style={{ background: "linear-gradient(90deg, #FF1F1F 0%, #0085FF 100%)" }}
      />
    </SliderPrimitive.Track>
    {(props.value ?? props.defaultValue ?? [0]).map((_, i) => (
      <SliderPrimitive.Thumb
        key={i}
        aria-label={thumbLabels?.[i]}
        className={cn(
          "block h-6 w-6 rounded-full shadow-md",
          "transition-transform duration-150 ease-out hover:scale-110 active:scale-105",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
        style={{ background: "linear-gradient(135deg, #FF1F1F 0%, #0085FF 100%)" }}
      />
    ))}
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
