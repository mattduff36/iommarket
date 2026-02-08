"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, X } from "lucide-react";

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
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-sm font-semibold text-text-primary"
        aria-expanded={open}
      >
        {title}
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
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
  priceRange = [0, 10000],
  priceMin = 0,
  priceMax = 10000,
  onPriceChange,
  conditions = [],
  selectedConditions = [],
  onConditionChange,
  onReset,
  className,
  ...props
}: FilterPanelProps) {
  function toggleValue(current: string[], value: string): string[] {
    return current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
  }

  const hasActiveFilters =
    selectedCategories.length > 0 ||
    selectedConditions.length > 0 ||
    priceRange[0] !== priceMin ||
    priceRange[1] !== priceMax;

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
          min={priceMin}
          max={priceMax}
          step={50}
          value={priceRange}
          onValueChange={(v) => onPriceChange?.(v as [number, number])}
        />
        <div className="flex items-center justify-between text-xs text-text-secondary">
          <span>£{priceRange[0].toLocaleString()}</span>
          <span>£{priceRange[1].toLocaleString()}</span>
        </div>
      </FilterSection>

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
