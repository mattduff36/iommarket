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
import { cn } from "@/lib/cn";

interface FilterOption {
  label: string;
  value: string;
  count?: number;
}

export interface SearchControlsProps {
  makes: FilterOption[];
  modelsByMake: Record<string, string[]>;
  modelCountsByMake?: Record<string, Record<string, number>>;
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

export function SearchControls({
  makes,
  modelsByMake,
  modelCountsByMake,
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
  const currentYear = getCurrentYear();

  const [make, setMake] = React.useState(initial.make ?? "");
  const [model, setModel] = React.useState(initial.model ?? "");
  const [region, setRegion] = React.useState(initial.region ?? "");

  const [priceRange, setPriceRange] = React.useState<[number, number]>(
    parseBoundedRange(initial.minPrice, initial.maxPrice, PRICE_MIN, PRICE_MAX),
  );
  const [mileageRange, setMileageRange] = React.useState<[number, number]>(
    parseBoundedRange(initial.minMileage, initial.maxMileage, MILEAGE_MIN, MILEAGE_MAX),
  );
  const [yearRange, setYearRange] = React.useState<[number, number]>(
    parseYearRange(initial.minYear, initial.maxYear),
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
    setRegion(initial.region ?? "");
    setPriceRange(parseBoundedRange(initial.minPrice, initial.maxPrice, PRICE_MIN, PRICE_MAX));
    setMileageRange(
      parseBoundedRange(initial.minMileage, initial.maxMileage, MILEAGE_MIN, MILEAGE_MAX),
    );
    setYearRange(parseYearRange(initial.minYear, initial.maxYear));
  }, [
    initial.make, initial.model, initial.region,
    initial.minPrice, initial.maxPrice, initial.minMileage, initial.maxMileage,
    initial.minYear, initial.maxYear,
  ]);

  const modelsForMake = make ? (modelsByMake[make] ?? []) : [];

  function getAllParams(): SearchParams {
    return {
      ...advancedParams,
      make: make || undefined,
      model: model || undefined,
      region: region || undefined,
      minPrice: priceRange[0] > PRICE_MIN ? String(priceRange[0]) : undefined,
      maxPrice: priceRange[1] < PRICE_MAX ? String(priceRange[1]) : undefined,
      minMileage: mileageRange[0] > MILEAGE_MIN ? String(mileageRange[0]) : undefined,
      maxMileage: mileageRange[1] < MILEAGE_MAX ? String(mileageRange[1]) : undefined,
      minYear: yearRange[0] > YEAR_MIN ? String(yearRange[0]) : undefined,
      maxYear: yearRange[1] < currentYear ? String(yearRange[1]) : undefined,
    };
  }

  function instantNav(overrides: Partial<SearchParams>) {
    if (mode === "instant") {
      router.push(buildSearchUrl(initial, overrides));
    }
  }

  function handleRegionChange(value: string) {
    const v = value === "any" ? "" : value;
    setRegion(v);
    instantNav({ region: v || undefined });
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
      minPrice: range[0] > PRICE_MIN ? String(range[0]) : undefined,
      maxPrice: range[1] < PRICE_MAX ? String(range[1]) : undefined,
    });
  }

  function handleMileageCommit(range: [number, number]) {
    instantNav({
      minMileage: range[0] > MILEAGE_MIN ? String(range[0]) : undefined,
      maxMileage: range[1] < MILEAGE_MAX ? String(range[1]) : undefined,
    });
  }

  function handleYearCommit(range: [number, number]) {
    instantNav({
      minYear: range[0] > YEAR_MIN ? String(range[0]) : undefined,
      maxYear: range[1] < currentYear ? String(range[1]) : undefined,
    });
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
      setMake(values.make ?? "");
      setModel(values.model ?? "");
      setRegion(values.region ?? "");
      setPriceRange(
        parseBoundedRange(values.minPrice, values.maxPrice, PRICE_MIN, PRICE_MAX),
      );
      setMileageRange(
        parseBoundedRange(values.minMileage, values.maxMileage, MILEAGE_MIN, MILEAGE_MAX),
      );
      setYearRange(parseYearRange(values.minYear, values.maxYear));
    }
  }

  function handleResetFilters() {
    setMake("");
    setModel("");
    setRegion("");
    setPriceRange([PRICE_MIN, PRICE_MAX]);
    setMileageRange([MILEAGE_MIN, MILEAGE_MAX]);
    setYearRange([YEAR_MIN, currentYear]);
    setAdvancedParams({});
    router.push("/search");
  }

  const selectClass = "h-11 rounded-sm border border-border bg-surface-elevated text-text-primary text-sm font-medium";

  return (
    <div className={cn("space-y-4", className)}>
      {/* ---- PRIMARY ROW ---- */}
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="w-full sm:w-[200px]">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Make
            </label>
            <Select value={make || "any"} onValueChange={handleMakeChange}>
              <SelectTrigger className={selectClass}>
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                {makes.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.count !== undefined ? `${m.label} (${m.count})` : m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-full sm:w-[200px]">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-secondary">
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
                {modelsForMake.map((m) => {
                  const count = modelCountsByMake?.[make]?.[m];
                  return (
                    <SelectItem key={m} value={m}>
                      {count !== undefined ? `${m} (${count})` : m}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {regions.length > 0 && (
            <div className="w-full sm:w-[180px]">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Location
              </label>
              <Select value={region || "any"} onValueChange={handleRegionChange}>
                <SelectTrigger className={selectClass}>
                  <SelectValue placeholder="Any area" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any area</SelectItem>
                  {regions.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button type="submit" className="h-11 w-full sm:w-auto rounded-lg px-6 text-sm font-semibold">
            <Search className="h-4 w-4" />
            Search
          </Button>
        </div>
      </form>

      {/* ---- MORE OPTIONS TOGGLE ---- */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setMoreOptionsOpen((o) => !o)}
          className="text-metallic-400 hover:text-text-primary"
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
            className="text-metallic-400 hover:text-text-primary"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Advanced Search
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleResetFilters}
          className="text-metallic-400 hover:text-text-primary"
        >
          Reset filters
        </Button>
      </div>

      {/* ---- MORE OPTIONS PANEL ---- */}
      {moreOptionsOpen && (
        <div className="space-y-5 rounded-lg border border-border bg-surface p-4 sm:p-5">
          <RangeSlider
            label="Price Range"
            min={PRICE_MIN}
            max={PRICE_MAX}
            step={PRICE_STEP}
            value={priceRange}
            onValueChange={setPriceRange}
            onValueCommit={handlePriceCommit}
            formatValue={(v) => `£${v.toLocaleString()}`}
            scale="logarithmic"
          />
          <RangeSlider
            label="Mileage Range"
            min={MILEAGE_MIN}
            max={MILEAGE_MAX}
            step={MILEAGE_STEP}
            value={mileageRange}
            onValueChange={setMileageRange}
            onValueCommit={handleMileageCommit}
            formatValue={(v) => `${v.toLocaleString()} mi`}
          />
          <RangeSlider
            label="Year"
            min={YEAR_MIN}
            max={currentYear}
            step={1}
            value={yearRange}
            onValueChange={setYearRange}
            onValueCommit={handleYearCommit}
            formatValue={String}
          />
        </div>
      )}

      {/* ---- ADVANCED SEARCH MODAL ---- */}
      <AdvancedSearchModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        makes={makes}
        modelsByMake={modelsByMake}
        modelCountsByMake={modelCountsByMake}
        categories={categories}
        regions={regions}
        initial={mode === "instant" ? initial : getAllParams()}
        onApply={handleAdvancedApply}
      />
    </div>
  );
}
