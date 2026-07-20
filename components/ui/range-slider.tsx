"use client";

import * as React from "react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/cn";
import {
  LOGARITHMIC_POSITION_MAX,
  logarithmicPositionToValue,
  valueToLogarithmicPosition,
} from "@/lib/utils/range-scale";

interface RangeSliderProps {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onValueChange: (value: [number, number]) => void;
  onValueCommit?: (value: [number, number]) => void;
  formatValue?: (value: number) => string;
  scale?: "linear" | "logarithmic";
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
  scale = "linear",
  className,
}: RangeSliderProps) {
  const id = React.useId();
  const isLogarithmic = scale === "logarithmic";
  const sliderValue: [number, number] = isLogarithmic
    ? [
        valueToLogarithmicPosition(value[0], min, max),
        valueToLogarithmicPosition(value[1], min, max),
      ]
    : value;

  function toExternalRange(sliderRange: number[]): [number, number] {
    const range = sliderRange as [number, number];
    if (!isLogarithmic) return range;
    return [
      logarithmicPositionToValue(range[0], min, max, step),
      logarithmicPositionToValue(range[1], min, max, step),
    ];
  }

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
        min={isLogarithmic ? 0 : min}
        max={isLogarithmic ? LOGARITHMIC_POSITION_MAX : max}
        step={isLogarithmic ? 1 : step}
        value={sliderValue}
        onValueChange={(v) => onValueChange(toExternalRange(v))}
        onValueCommit={
          onValueCommit
            ? (v) => onValueCommit(toExternalRange(v))
            : undefined
        }
        thumbLabels={[`Minimum ${label}`, `Maximum ${label}`]}
        thumbValueTexts={[formatValue(value[0]), formatValue(value[1])]}
      />
    </div>
  );
}

export { RangeSlider };
export type { RangeSliderProps };
