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
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PRICE_RANGE_OPTIONS,
  MAX_AGE_OPTIONS,
  priceRangeToMinMax,
  minMaxToPriceRange,
  ageToYearRange,
  yearRangeToAge,
} from "@/lib/constants/search-filters";

const MILEAGE_MAX = 150000;

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

function parseNum(s: string | undefined, fallback: number): number {
  if (s === undefined || s === "") return fallback;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? fallback : n;
}

export function MoreOptionsModal({
  open,
  onOpenChange,
  makes,
  modelsByMake,
  initial,
  onApply,
}: MoreOptionsModalProps) {
  const [make, setMake] = React.useState(initial.make ?? "");
  const [model, setModel] = React.useState(initial.model ?? "");
  const [priceRangeValue, setPriceRangeValue] = React.useState(
    () => minMaxToPriceRange(initial.minPrice ?? "", initial.maxPrice ?? "") || ""
  );
  const [mileageRange, setMileageRange] = React.useState<[number, number]>([
    parseNum(initial.minMileage, 0),
    parseNum(initial.maxMileage, MILEAGE_MAX),
  ]);
  const [maxAgeValue, setMaxAgeValue] = React.useState(
    () => yearRangeToAge(initial.minYear ?? "", initial.maxYear ?? "") || ""
  );

  const modelsForMake = make ? (modelsByMake[make] ?? []) : [];

  React.useEffect(() => {
    if (open) {
      setMake(initial.make ?? "");
      setModel(initial.model ?? "");
      setPriceRangeValue(minMaxToPriceRange(initial.minPrice ?? "", initial.maxPrice ?? "") || "");
      setMileageRange([
        parseNum(initial.minMileage, 0),
        parseNum(initial.maxMileage, MILEAGE_MAX),
      ]);
      setMaxAgeValue(yearRangeToAge(initial.minYear ?? "", initial.maxYear ?? "") || "");
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
    const { minPrice, maxPrice } = priceRangeToMinMax(priceRangeValue);
    const { minYear, maxYear } = ageToYearRange(maxAgeValue);
    onApply({
      make,
      model,
      minPrice,
      maxPrice,
      minMileage: mileageRange[0] > 0 ? String(mileageRange[0]) : "",
      maxMileage: mileageRange[1] < MILEAGE_MAX ? String(mileageRange[1]) : "",
      minYear,
      maxYear,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>More options</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="grid grid-cols-2 gap-4">
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

          <div>
            <label className="mb-1 block text-sm font-medium text-text-primary">
              Price range
            </label>
            <Select
              value={priceRangeValue || "any"}
              onValueChange={(v) => setPriceRangeValue(v === "any" ? "" : v)}
            >
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                {PRICE_RANGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value || "any"} value={o.value || "any"}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-text-primary">
              Mileage &ndash; {mileageRange[0].toLocaleString()} –{" "}
              {mileageRange[1].toLocaleString()} miles
            </label>
            <Slider
              min={0}
              max={MILEAGE_MAX}
              step={5000}
              value={mileageRange}
              onValueChange={(v) => setMileageRange(v as [number, number])}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-text-primary">
              Maximum age
            </label>
            <Select
              value={maxAgeValue || "any"}
              onValueChange={(v) => setMaxAgeValue(v === "any" ? "" : v)}
            >
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                {MAX_AGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value || "any"} value={o.value || "any"}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
