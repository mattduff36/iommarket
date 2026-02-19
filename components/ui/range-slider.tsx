"use client";

import * as React from "react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/cn";

interface RangeSliderProps {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onValueChange: (value: [number, number]) => void;
  onValueCommit?: (value: [number, number]) => void;
  formatValue?: (value: number) => string;
  className?: string;
}

function RangeSlider({
  label,
  min,
  max,
  step = 1,
  value,
  onValueChange,
  onValueCommit,
  formatValue = String,
  className,
}: RangeSliderProps) {
  const id = React.useId();

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <label id={`${id}-label`} className="text-sm font-medium text-text-primary">
          {label}
        </label>
        <span className="text-xs text-text-secondary">
          {formatValue(value[0])} &ndash; {formatValue(value[1])}
        </span>
      </div>
      <Slider
        aria-labelledby={`${id}-label`}
        min={min}
        max={max}
        step={step}
        value={value}
        onValueChange={(v) => onValueChange(v as [number, number])}
        onValueCommit={
          onValueCommit
            ? (v) => onValueCommit(v as [number, number])
            : undefined
        }
        thumbLabels={[`Minimum ${label}`, `Maximum ${label}`]}
      />
    </div>
  );
}

export { RangeSlider };
export type { RangeSliderProps };
