"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import {
  MILEAGE_MAX,
  MILEAGE_MIN,
  MILEAGE_STEP,
  PRICE_MAX,
  PRICE_MIN,
  PRICE_STEP,
  YEAR_MIN,
  getCurrentYear,
} from "@/lib/constants/search-filters";
import {
  LOGARITHMIC_POSITION_MAX,
  logarithmicPositionToValue,
  valueToLogarithmicPosition,
} from "@/lib/utils/range-scale";

/* ------------------------------------------------------------------ */
/*  Filter section (collapsible)                                      */
/* ------------------------------------------------------------------ */

interface FilterSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function FilterSection({ title, defaultOpen = true, children }: FilterSectionProps) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div className="border-b border-border py-4 first:pt-0 last:border-0">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        className="w-full justify-between text-sm font-semibold text-text-primary"
        aria-expanded={open}
      >
        {title}
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </Button>
      {open && <div className="mt-3 flex flex-col gap-2">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main FilterPanel                                                  */
/* ------------------------------------------------------------------ */

export interface FilterOption {
  label: string;
  value: string;
  count?: number;
}

export interface FilterPanelProps extends React.HTMLAttributes<HTMLElement> {
  /** Category filter options */
  categories?: FilterOption[];
  selectedCategories?: string[];
  onCategoryChange?: (values: string[]) => void;

  /** Price range */
  priceRange?: [number, number];
  priceMin?: number;
  priceMax?: number;
  onPriceChange?: (range: [number, number]) => void;

  /** Mileage range */
  mileageRange?: [number, number];
  mileageMin?: number;
  mileageMax?: number;
  onMileageChange?: (range: [number, number]) => void;

  /** Year range */
  yearRange?: [number, number];
  yearMin?: number;
  yearMax?: number;
  onYearChange?: (range: [number, number]) => void;

  /** Make / Model (vehicle) */
  makes?: string[];
  models?: string[];
  selectedMake?: string;
  selectedModel?: string;
  onMakeChange?: (value: string) => void;
  onModelChange?: (value: string) => void;

  /** Condition filter options */
  conditions?: FilterOption[];
  selectedConditions?: string[];
  onConditionChange?: (values: string[]) => void;

  /** Reset all */
  onReset?: () => void;
}

function FilterPanel({
  categories = [],
  selectedCategories = [],
  onCategoryChange,
  priceRange = [PRICE_MIN, PRICE_MAX],
  priceMin = PRICE_MIN,
  priceMax = PRICE_MAX,
  onPriceChange,
  mileageRange,
  mileageMin = MILEAGE_MIN,
  mileageMax = MILEAGE_MAX,
  onMileageChange,
  yearRange,
  yearMin = YEAR_MIN,
  yearMax = getCurrentYear(),
  onYearChange,
  makes = [],
  models = [],
  selectedMake,
  selectedModel,
  onMakeChange,
  onModelChange,
  conditions = [],
  selectedConditions = [],
  onConditionChange,
  onReset,
  className,
  ...props
}: FilterPanelProps) {
  const isPriceLogarithmic = priceMin > 0;
  const priceSliderValue = isPriceLogarithmic
    ? priceRange.map((value) =>
        valueToLogarithmicPosition(value, priceMin, priceMax),
      )
    : priceRange;

  function toggleValue(current: string[], value: string): string[] {
    return current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
  }

  function handlePriceSliderChange(values: number[]): void {
    if (!isPriceLogarithmic) {
      onPriceChange?.(values as [number, number]);
      return;
    }

    onPriceChange?.([
      logarithmicPositionToValue(values[0], priceMin, priceMax, PRICE_STEP),
      logarithmicPositionToValue(values[1], priceMin, priceMax, PRICE_STEP),
    ]);
  }

  const hasActiveFilters =
    selectedCategories.length > 0 ||
    selectedConditions.length > 0 ||
    priceRange[0] !== priceMin ||
    priceRange[1] !== priceMax ||
    (mileageRange !== undefined &&
      (mileageRange[0] !== mileageMin || mileageRange[1] !== mileageMax)) ||
    (yearRange !== undefined &&
      (yearRange[0] !== yearMin || yearRange[1] !== yearMax)) ||
    (selectedMake?.length ?? 0) > 0 ||
    (selectedModel?.length ?? 0) > 0;

  return (
    <aside
      className={cn("w-[280px] shrink-0", className)}
      aria-label="Filters"
      {...props}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-4">
        <h2 className="text-base font-semibold text-text-primary">Filters</h2>
        {hasActiveFilters && onReset && (
          <Button variant="ghost" size="sm" onClick={onReset}>
            <X className="h-3 w-3 mr-1" />
            Reset
          </Button>
        )}
      </div>

      {/* Categories */}
      {categories.length > 0 && (
        <FilterSection title="Category">
          {categories.map((cat) => (
            <div key={cat.value} className="flex items-center justify-between">
              <Checkbox
                label={cat.label}
                checked={selectedCategories.includes(cat.value)}
                onCheckedChange={() =>
                  onCategoryChange?.(toggleValue(selectedCategories, cat.value))
                }
              />
              {cat.count !== undefined && (
                <span className="text-xs text-text-tertiary">{cat.count}</span>
              )}
            </div>
          ))}
        </FilterSection>
      )}

      {/* Price Range */}
      <FilterSection title="Price Range">
        <Slider
          min={isPriceLogarithmic ? 0 : priceMin}
          max={isPriceLogarithmic ? LOGARITHMIC_POSITION_MAX : priceMax}
          step={isPriceLogarithmic ? 1 : PRICE_STEP}
          value={priceSliderValue}
          onValueChange={handlePriceSliderChange}
          thumbLabels={["Minimum Price Range", "Maximum Price Range"]}
          thumbValueTexts={[
            `£${priceRange[0].toLocaleString()}`,
            `£${priceRange[1].toLocaleString()}`,
          ]}
        />
        <div className="flex items-center justify-between text-xs text-text-secondary">
          <span>£{priceRange[0].toLocaleString()}</span>
          <span>£{priceRange[1].toLocaleString()}</span>
        </div>
      </FilterSection>

      {/* Mileage */}
      {mileageRange !== undefined && onMileageChange && (
        <FilterSection title="Mileage">
          <Slider
            min={mileageMin}
            max={mileageMax}
            step={MILEAGE_STEP}
            value={mileageRange}
            onValueChange={(v) => onMileageChange(v as [number, number])}
          />
          <div className="flex items-center justify-between text-xs text-text-secondary">
            <span>{mileageRange[0].toLocaleString()} mi</span>
            <span>{mileageRange[1].toLocaleString()} mi</span>
          </div>
        </FilterSection>
      )}

      {/* Year */}
      {yearRange !== undefined && onYearChange && (
        <FilterSection title="Year">
          <Slider
            min={yearMin}
            max={yearMax}
            step={1}
            value={yearRange}
            onValueChange={(v) => onYearChange(v as [number, number])}
          />
          <div className="flex items-center justify-between text-xs text-text-secondary">
            <span>{yearRange[0]}</span>
            <span>{yearRange[1]}</span>
          </div>
        </FilterSection>
      )}

      {/* Make / Model */}
      {(makes.length > 0 || models.length > 0) && (onMakeChange || onModelChange) && (
        <FilterSection title="Vehicle">
          {makes.length > 0 && onMakeChange && (
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">
                Make
              </label>
              <Select
                value={selectedMake || "any"}
                onValueChange={(v) => onMakeChange(v === "any" ? "" : v)}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  {makes.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {models.length > 0 && onModelChange && (
            <div className="mt-2">
              <label className="mb-1 block text-xs font-medium text-text-secondary">
                Model
              </label>
              <Select
                value={selectedModel || "any"}
                onValueChange={(v) => onModelChange(v === "any" ? "" : v)}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  {models.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </FilterSection>
      )}

      {/* Conditions */}
      {conditions.length > 0 && (
        <FilterSection title="Condition">
          {conditions.map((cond) => (
            <div key={cond.value} className="flex items-center justify-between">
              <Checkbox
                label={cond.label}
                checked={selectedConditions.includes(cond.value)}
                onCheckedChange={() =>
                  onConditionChange?.(toggleValue(selectedConditions, cond.value))
                }
              />
              {cond.count !== undefined && (
                <span className="text-xs text-text-tertiary">{cond.count}</span>
              )}
            </div>
          ))}
        </FilterSection>
      )}
    </aside>
  );
}

export { FilterPanel, FilterSection };
