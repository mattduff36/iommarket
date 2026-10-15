"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RangeSlider } from "@/components/ui/range-slider";
import {
  categorySearchControls,
  type CategoryControlState,
  type VehicleCategorySlug,
} from "@/lib/search/category-filters";

interface CategorySearchFieldsProps {
  categorySlug: VehicleCategorySlug | null;
  values: CategoryControlState;
  onChange: (values: CategoryControlState) => void;
}

export function CategorySearchFields({
  categorySlug,
  values,
  onChange,
}: CategorySearchFieldsProps) {
  const controls = categorySearchControls(categorySlug);
  if (controls.selects.length === 0 && controls.ranges.length === 0) return null;

  return (
    <div className="mt-4 space-y-4">
      {controls.selects.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {controls.selects.map((control) => (
            <div key={control.key}>
              <label className="mb-1 block text-xs font-medium text-text-secondary">
                {control.label}
              </label>
              <Select
                value={values.selects[control.key] || "any"}
                onValueChange={(next) =>
                  onChange({
                    ...values,
                    selects: {
                      ...values.selects,
                      [control.key]: next === "any" ? "" : next,
                    },
                  })
                }
              >
                <SelectTrigger className="h-10 text-sm">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent className="max-w-[calc(100vw-2rem)]">
                  <SelectItem value="any">Any</SelectItem>
                  {control.options.map((option) => (
                    <SelectItem
                      key={option}
                      value={option}
                      className="whitespace-normal break-words leading-snug"
                    >
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      )}
      {controls.ranges.map((control) => (
        <RangeSlider
          key={control.key}
          label={control.label}
          min={control.min}
          max={control.max}
          step={control.step}
          value={values.ranges[control.key]}
          onValueChange={(range) =>
            onChange({
              ...values,
              ranges: { ...values.ranges, [control.key]: range },
            })
          }
          formatValue={control.formatValue}
        />
      ))}
    </div>
  );
}
