"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RangeSlider } from "@/components/ui/range-slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MILEAGE_MAX,
  MILEAGE_MIN,
  MILEAGE_STEP,
  PRICE_MAX,
  PRICE_MIN,
  PRICE_STEP,
  YEAR_MIN,
  getCurrentYear,
  parseBoundedRange,
  parseYearRange,
} from "@/lib/constants/search-filters";

export interface MoreOptionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  makes: string[];
  modelsByMake: Record<string, string[]>;
  initial: {
    make?: string;
    model?: string;
    minPrice?: string;
    maxPrice?: string;
    minMileage?: string;
    maxMileage?: string;
    minYear?: string;
    maxYear?: string;
  };
  onApply: (values: {
    make: string;
    model: string;
    minPrice: string;
    maxPrice: string;
    minMileage: string;
    maxMileage: string;
    minYear: string;
    maxYear: string;
  }) => void;
}

export function MoreOptionsModal({
  open,
  onOpenChange,
  makes,
  modelsByMake,
  initial,
  onApply,
}: MoreOptionsModalProps) {
  const currentYear = getCurrentYear();
  const [make, setMake] = React.useState(initial.make ?? "");
  const [model, setModel] = React.useState(initial.model ?? "");
  const [priceRange, setPriceRange] = React.useState<[number, number]>(
    parseBoundedRange(initial.minPrice, initial.maxPrice, PRICE_MIN, PRICE_MAX),
  );
  const [mileageRange, setMileageRange] = React.useState<[number, number]>(
    parseBoundedRange(initial.minMileage, initial.maxMileage, MILEAGE_MIN, MILEAGE_MAX),
  );
  const [yearRange, setYearRange] = React.useState<[number, number]>(
    parseYearRange(initial.minYear, initial.maxYear),
  );

  const modelsForMake = make ? (modelsByMake[make] ?? []) : [];

  React.useEffect(() => {
    if (open) {
      setMake(initial.make ?? "");
      setModel(initial.model ?? "");
      setPriceRange(
        parseBoundedRange(initial.minPrice, initial.maxPrice, PRICE_MIN, PRICE_MAX),
      );
      setMileageRange(
        parseBoundedRange(initial.minMileage, initial.maxMileage, MILEAGE_MIN, MILEAGE_MAX),
      );
      setYearRange(parseYearRange(initial.minYear, initial.maxYear));
    }
  }, [
    open,
    initial.make,
    initial.model,
    initial.minPrice,
    initial.maxPrice,
    initial.minMileage,
    initial.maxMileage,
    initial.minYear,
    initial.maxYear,
  ]);

  function handleMakeChange(value: string) {
    const newMake = value === "any" ? "" : value;
    setMake(newMake);
    setModel("");
  }

  function handleApply() {
    onApply({
      make,
      model,
      minPrice: priceRange[0] > PRICE_MIN ? String(priceRange[0]) : "",
      maxPrice: priceRange[1] < PRICE_MAX ? String(priceRange[1]) : "",
      minMileage: mileageRange[0] > MILEAGE_MIN ? String(mileageRange[0]) : "",
      maxMileage: mileageRange[1] < MILEAGE_MAX ? String(mileageRange[1]) : "",
      minYear: yearRange[0] > YEAR_MIN ? String(yearRange[0]) : "",
      maxYear: yearRange[1] < currentYear ? String(yearRange[1]) : "",
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>More options</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-text-primary">
                Make
              </label>
              <Select value={make || "any"} onValueChange={handleMakeChange}>
                <SelectTrigger className="h-10">
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
            <div>
              <label className="mb-1 block text-sm font-medium text-text-primary">
                Model
              </label>
              <Select
                value={model || "any"}
                onValueChange={(v) => setModel(v === "any" ? "" : v)}
                disabled={!make}
              >
                <SelectTrigger className="h-10" aria-disabled={!make}>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  {modelsForMake.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <RangeSlider
            label="Price Range"
            min={PRICE_MIN}
            max={PRICE_MAX}
            step={PRICE_STEP}
            value={priceRange}
            onValueChange={setPriceRange}
            formatValue={(value) => `£${value.toLocaleString()}`}
            scale="logarithmic"
          />

          <RangeSlider
            label="Mileage"
            min={MILEAGE_MIN}
            max={MILEAGE_MAX}
            step={MILEAGE_STEP}
            value={mileageRange}
            onValueChange={setMileageRange}
            formatValue={(value) => `${value.toLocaleString()} mi`}
          />

          <RangeSlider
            label="Year"
            min={YEAR_MIN}
            max={currentYear}
            step={1}
            value={yearRange}
            onValueChange={setYearRange}
            formatValue={String}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleApply}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
