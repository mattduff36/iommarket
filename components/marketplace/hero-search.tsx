"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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
import { MoreOptionsModal } from "./more-options-modal";

const MILEAGE_OPTIONS = [
  { label: "Any", value: "" },
  { label: "Up to 20k", value: "20000" },
  { label: "Up to 50k", value: "50000" },
  { label: "Up to 100k", value: "100000" },
  { label: "Up to 150k", value: "150000" },
];

export interface HeroSearchProps {
  makes: string[];
  /** Map of make -> list of model names (model dropdown is disabled until make is selected) */
  modelsByMake: Record<string, string[]>;
  /** Initial values from URL (for pre-fill when opening More options) */
  initial?: {
    make?: string;
    model?: string;
    minPrice?: string;
    maxPrice?: string;
    minMileage?: string;
    maxMileage?: string;
    minYear?: string;
    maxYear?: string;
  };
}

export function HeroSearch({ makes, modelsByMake, initial = {} }: HeroSearchProps) {
  const router = useRouter();
  const [moreOptionsOpen, setMoreOptionsOpen] = React.useState(false);
  const [make, setMake] = React.useState(initial.make ?? "");
  const [model, setModel] = React.useState(initial.model ?? "");
  const [minPrice, setMinPrice] = React.useState(initial.minPrice ?? "");
  const [maxPrice, setMaxPrice] = React.useState(initial.maxPrice ?? "");
  const [minMileage, setMinMileage] = React.useState(initial.minMileage ?? "");
  const [maxMileage, setMaxMileage] = React.useState(initial.maxMileage ?? "");
  const [minYear, setMinYear] = React.useState(initial.minYear ?? "");
  const [maxYear, setMaxYear] = React.useState(initial.maxYear ?? "");

  const priceRangeValue = minMaxToPriceRange(minPrice, maxPrice) || "any";
  const maxAgeValue = yearRangeToAge(minYear, maxYear) || "any";
  const modelsForMake = make ? (modelsByMake[make] ?? []) : [];

  function handleMakeChange(value: string) {
    const newMake = value === "any" ? "" : value;
    setMake(newMake);
    setModel("");
  }

  function buildSearchParams(overrides?: Record<string, string>) {
    const params = new URLSearchParams();
    const m = overrides?.make ?? make;
    const mod = overrides?.model ?? model;
    const minP = overrides?.minPrice ?? minPrice;
    const maxP = overrides?.maxPrice ?? maxPrice;
    const minMi = overrides?.minMileage ?? minMileage;
    const maxMi = overrides?.maxMileage ?? maxMileage;
    const minY = overrides?.minYear ?? minYear;
    const maxY = overrides?.maxYear ?? maxYear;
    if (m) params.set("make", m);
    if (mod) params.set("model", mod);
    if (minP) params.set("minPrice", minP);
    if (maxP) params.set("maxPrice", maxP);
    if (minMi) params.set("minMileage", minMi);
    if (maxMi) params.set("maxMileage", maxMi);
    if (minY) params.set("minYear", minY);
    if (maxY) params.set("maxYear", maxY);
    return params;
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const params = buildSearchParams();
    const qs = params.toString();
    router.push(qs ? `/search?${qs}` : "/search");
  }

  function handleMoreOptionsApply(values: {
    make: string;
    model: string;
    minPrice: string;
    maxPrice: string;
    minMileage: string;
    maxMileage: string;
    minYear: string;
    maxYear: string;
  }) {
    setMake(values.make);
    setModel(values.model);
    setMinPrice(values.minPrice);
    setMaxPrice(values.maxPrice);
    setMinMileage(values.minMileage);
    setMaxMileage(values.maxMileage);
    setMinYear(values.minYear);
    setMaxYear(values.maxYear);
    setMoreOptionsOpen(false);
    const params = new URLSearchParams();
    if (values.make) params.set("make", values.make);
    if (values.model) params.set("model", values.model);
    if (values.minPrice) params.set("minPrice", values.minPrice);
    if (values.maxPrice) params.set("maxPrice", values.maxPrice);
    if (values.minMileage) params.set("minMileage", values.minMileage);
    if (values.maxMileage) params.set("maxMileage", values.maxMileage);
    if (values.minYear) params.set("minYear", values.minYear);
    if (values.maxYear) params.set("maxYear", values.maxYear);
    router.push(params.toString() ? `/search?${params.toString()}` : "/search");
  }

  const selectClass =
    "h-11 rounded-lg border border-slate-200 bg-white text-slate-900 text-sm font-medium";

  return (
    <>
      <form
        onSubmit={handleSubmit}
        className="mx-auto mt-10 max-w-4xl rounded-2xl bg-white/95 p-4 shadow-xl backdrop-blur sm:p-5"
      >
        <div className="grid grid-cols-2 gap-4 items-end sm:flex sm:flex-row sm:flex-wrap">
          <div className="min-w-[120px] flex-1 sm:max-w-[140px]">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Make
            </label>
            <Select name="make" value={make || "any"} onValueChange={handleMakeChange}>
              <SelectTrigger className={selectClass}>
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
          <div className="min-w-[120px] flex-1 sm:max-w-[160px]">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Model
            </label>
            <Select
              name="model"
              value={model || "any"}
              onValueChange={(v) => setModel(v === "any" ? "" : v)}
              disabled={!make}
            >
              <SelectTrigger className={selectClass} aria-disabled={!make}>
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
          <div className="min-w-[140px] flex-1 sm:max-w-[180px]">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Price range
            </label>
            <Select
              name="priceRange"
              value={priceRangeValue}
              onValueChange={(v) => {
                const { minPrice: min, maxPrice: max } = priceRangeToMinMax(v === "any" ? "" : v);
                setMinPrice(min);
                setMaxPrice(max);
              }}
            >
              <SelectTrigger className={selectClass}>
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
          <div className="min-w-[100px] sm:max-w-[120px]">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Max mileage
            </label>
            <Select name="maxMileage" value={maxMileage || "any"} onValueChange={(v) => setMaxMileage(v === "any" ? "" : v)}>
              <SelectTrigger className={selectClass}>
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                {MILEAGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value || "any"} value={o.value || "any"}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[120px] sm:max-w-[140px]">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Maximum age
            </label>
            <Select
              name="maxAge"
              value={maxAgeValue}
              onValueChange={(v) => {
                const { minYear: min, maxYear: max } = ageToYearRange(v === "any" ? "" : v);
                setMinYear(min);
                setMaxYear(max);
              }}
            >
              <SelectTrigger className={selectClass}>
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
          <div className="flex items-end justify-center sm:justify-start">
            <Button type="submit" size="lg" className="h-11 rounded-lg px-6">
              Search
            </Button>
          </div>
        </div>
      </form>

      <div className="mt-8">
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="rounded-lg px-6"
          onClick={() => setMoreOptionsOpen(true)}
        >
          More options
        </Button>
      </div>

      <MoreOptionsModal
        open={moreOptionsOpen}
        onOpenChange={setMoreOptionsOpen}
        makes={makes}
        modelsByMake={modelsByMake}
        initial={{
          make,
          model,
          minPrice,
          maxPrice,
          minMileage,
          maxMileage,
          minYear,
          maxYear,
        }}
        onApply={handleMoreOptionsApply}
      />
    </>
  );
}
