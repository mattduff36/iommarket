"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RangeSlider } from "@/components/ui/range-slider";
import { AdvancedSearchModal } from "./advanced-search-modal";
import { buildSearchUrl, type SearchParams } from "@/lib/search/search-url";
import {
  ageRangeToYearRange,
  yearRangeToAgeRange,
} from "@/lib/constants/search-filters";
import { cn } from "@/lib/cn";

const PRICE_MAX = 100_000;
const PRICE_STEP = 500;
const MILEAGE_MAX = 150_000;
const MILEAGE_STEP = 5_000;
const AGE_MAX = 15;

interface FilterOption {
  label: string;
  value: string;
  count?: number;
}

export interface SearchControlsProps {
  makes: string[];
  modelsByMake: Record<string, string[]>;
  categories?: FilterOption[];
  regions?: FilterOption[];
  initial?: SearchParams;
  mode: "instant" | "submit";
  className?: string;
  /** When true the Advanced Search button + modal are rendered inline (e.g. /search page). When false (default) the parent is responsible for rendering them. */
  showAdvancedInline?: boolean;
  /** Exposes a trigger so the parent can open the advanced modal from outside */
  advancedModalOpen?: boolean;
  onAdvancedModalOpenChange?: (open: boolean) => void;
}

function parseNum(s: string | undefined, fallback: number): number {
  if (!s) return fallback;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? fallback : n;
}

export function SearchControls({
  makes,
  modelsByMake,
  categories = [],
  regions = [],
  initial = {},
  mode,
  className,
  showAdvancedInline = false,
  advancedModalOpen: externalModalOpen,
  onAdvancedModalOpenChange,
}: SearchControlsProps) {
  const router = useRouter();

  const [make, setMake] = React.useState(initial.make ?? "");
  const [model, setModel] = React.useState(initial.model ?? "");

  const [priceRange, setPriceRange] = React.useState<[number, number]>([
    parseNum(initial.minPrice, 0),
    parseNum(initial.maxPrice, PRICE_MAX),
  ]);
  const [mileageRange, setMileageRange] = React.useState<[number, number]>([
    parseNum(initial.minMileage, 0),
    parseNum(initial.maxMileage, MILEAGE_MAX),
  ]);
  const [ageRange, setAgeRange] = React.useState<[number, number]>(
    yearRangeToAgeRange(initial.minYear, initial.maxYear),
  );

  const hasMoreOptionsFilters = Boolean(
    initial.minPrice || initial.maxPrice ||
    initial.minMileage || initial.maxMileage ||
    initial.minYear || initial.maxYear,
  );

  const [moreOptionsOpen, setMoreOptionsOpen] = React.useState(hasMoreOptionsFilters);

  const [internalModalOpen, setInternalModalOpen] = React.useState(false);
  const modalOpen = externalModalOpen ?? internalModalOpen;
  const setModalOpen = onAdvancedModalOpenChange ?? setInternalModalOpen;

  const [advancedParams, setAdvancedParams] = React.useState<SearchParams>({});

  React.useEffect(() => {
    setMake(initial.make ?? "");
    setModel(initial.model ?? "");
    setPriceRange([parseNum(initial.minPrice, 0), parseNum(initial.maxPrice, PRICE_MAX)]);
    setMileageRange([parseNum(initial.minMileage, 0), parseNum(initial.maxMileage, MILEAGE_MAX)]);
    setAgeRange(yearRangeToAgeRange(initial.minYear, initial.maxYear));
  }, [
    initial.make, initial.model,
    initial.minPrice, initial.maxPrice, initial.minMileage, initial.maxMileage,
    initial.minYear, initial.maxYear,
  ]);

  const modelsForMake = make ? (modelsByMake[make] ?? []) : [];

  function getAllParams(): SearchParams {
    const isAgeDefault = ageRange[0] === 0 && ageRange[1] >= AGE_MAX;
    const yearParams = isAgeDefault
      ? { minYear: undefined, maxYear: undefined }
      : {
          minYear: ageRangeToYearRange(ageRange).minYear || undefined,
          maxYear: ageRangeToYearRange(ageRange).maxYear || undefined,
        };

    return {
      ...advancedParams,
      make: make || undefined,
      model: model || undefined,
      minPrice: priceRange[0] > 0 ? String(priceRange[0]) : undefined,
      maxPrice: priceRange[1] < PRICE_MAX ? String(priceRange[1]) : undefined,
      minMileage: mileageRange[0] > 0 ? String(mileageRange[0]) : undefined,
      maxMileage: mileageRange[1] < MILEAGE_MAX ? String(mileageRange[1]) : undefined,
      minYear: yearParams.minYear,
      maxYear: yearParams.maxYear,
    };
  }

  function instantNav(overrides: Partial<SearchParams>) {
    if (mode === "instant") {
      router.push(buildSearchUrl(initial, overrides));
    }
  }

  function handleMakeChange(value: string) {
    const v = value === "any" ? "" : value;
    setMake(v);
    setModel("");
    instantNav({ make: v || undefined, model: undefined });
  }

  function handleModelChange(value: string) {
    const v = value === "any" ? "" : value;
    setModel(v);
    instantNav({ model: v || undefined });
  }

  function handlePriceCommit(range: [number, number]) {
    instantNav({
      minPrice: range[0] > 0 ? String(range[0]) : undefined,
      maxPrice: range[1] < PRICE_MAX ? String(range[1]) : undefined,
    });
  }

  function handleMileageCommit(range: [number, number]) {
    instantNav({
      minMileage: range[0] > 0 ? String(range[0]) : undefined,
      maxMileage: range[1] < MILEAGE_MAX ? String(range[1]) : undefined,
    });
  }

  function handleAgeCommit(range: [number, number]) {
    const isDefault = range[0] === 0 && range[1] >= AGE_MAX;
    if (isDefault) {
      instantNav({ minYear: undefined, maxYear: undefined });
      return;
    }
    const { minYear, maxYear } = ageRangeToYearRange(range);
    instantNav({ minYear, maxYear });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    router.push(buildSearchUrl({}, getAllParams()));
  }

  function handleAdvancedApply(values: SearchParams) {
    if (mode === "instant") {
      router.push(buildSearchUrl({}, values));
    } else {
      setAdvancedParams(values);
      if (values.make) setMake(values.make);
      if (values.model) setModel(values.model);
      if (values.minPrice || values.maxPrice) {
        setPriceRange([
          parseNum(values.minPrice, 0),
          parseNum(values.maxPrice, PRICE_MAX),
        ]);
      }
      if (values.minMileage || values.maxMileage) {
        setMileageRange([
          parseNum(values.minMileage, 0),
          parseNum(values.maxMileage, MILEAGE_MAX),
        ]);
      }
      if (values.minYear || values.maxYear) {
        setAgeRange(yearRangeToAgeRange(values.minYear, values.maxYear));
      }
    }
  }

  const selectClass = "h-11 rounded-lg border border-slate-200 bg-white text-slate-900 text-sm font-medium";

  return (
    <div className={cn("space-y-4", className)}>
      {/* ---- PRIMARY ROW ---- */}
      <form onSubmit={handleSubmit}>
        <div className="inline-flex flex-wrap items-end gap-3">
          <div className="w-[240px]">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Make
            </label>
            <Select value={make || "any"} onValueChange={handleMakeChange}>
              <SelectTrigger className={selectClass}>
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                {makes.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-[240px]">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Model
            </label>
            <Select
              value={model || "any"}
              onValueChange={handleModelChange}
              disabled={!make}
            >
              <SelectTrigger className={cn(selectClass, !make && "opacity-60")} aria-disabled={!make}>
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                {modelsForMake.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button type="submit" className="h-11 rounded-lg px-6 text-sm font-semibold">
            <Search className="h-4 w-4" />
            Search
          </Button>
        </div>
      </form>

      {/* ---- MORE OPTIONS TOGGLE ---- */}
      <div className="flex items-center gap-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setMoreOptionsOpen((o) => !o)}
          className="text-slate-500 hover:text-slate-800"
          aria-expanded={moreOptionsOpen}
        >
          More Options
          {moreOptionsOpen
            ? <ChevronUp className="h-3.5 w-3.5" />
            : <ChevronDown className="h-3.5 w-3.5" />}
        </Button>

        {showAdvancedInline && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setModalOpen(true)}
            className="text-slate-500 hover:text-slate-800"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Advanced Search
          </Button>
        )}
      </div>

      {/* ---- MORE OPTIONS PANEL ---- */}
      {moreOptionsOpen && (
        <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-5">
          <RangeSlider
            label="Price Range"
            min={0}
            max={PRICE_MAX}
            step={PRICE_STEP}
            value={priceRange}
            onValueChange={setPriceRange}
            onValueCommit={handlePriceCommit}
            formatValue={(v) => `£${v.toLocaleString()}`}
          />
          <RangeSlider
            label="Mileage Range"
            min={0}
            max={MILEAGE_MAX}
            step={MILEAGE_STEP}
            value={mileageRange}
            onValueChange={setMileageRange}
            onValueCommit={handleMileageCommit}
            formatValue={(v) => `${v.toLocaleString()} mi`}
          />
          <RangeSlider
            label="Age Range"
            min={0}
            max={AGE_MAX}
            step={1}
            value={ageRange}
            onValueChange={setAgeRange}
            onValueCommit={handleAgeCommit}
            formatValue={(v) => v === 1 ? "1 year" : `${v} years`}
          />
        </div>
      )}

      {/* ---- ADVANCED SEARCH MODAL ---- */}
      <AdvancedSearchModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        makes={makes}
        modelsByMake={modelsByMake}
        categories={categories}
        regions={regions}
        initial={mode === "instant" ? initial : getAllParams()}
        onApply={handleAdvancedApply}
      />
    </div>
  );
}
