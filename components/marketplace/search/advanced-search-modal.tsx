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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchBar } from "@/components/marketplace/search-bar";
import { RangeSlider } from "@/components/ui/range-slider";
import { type SearchParams } from "@/lib/search/search-url";
import {
  ageRangeToYearRange,
  yearRangeToAgeRange,
  BODY_TYPE_OPTIONS,
  COLOUR_OPTIONS,
  FUEL_TYPE_OPTIONS,
  TRANSMISSION_OPTIONS,
  DRIVE_TYPE_OPTIONS,
  SELLER_TYPE_OPTIONS,
  DOORS_OPTIONS,
  SEATS_OPTIONS,
} from "@/lib/constants/search-filters";

interface FilterOption {
  label: string;
  value: string;
}

export interface AdvancedSearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  makes: string[];
  modelsByMake: Record<string, string[]>;
  categories?: FilterOption[];
  regions?: FilterOption[];
  initial: SearchParams;
  onApply: (values: SearchParams) => void;
}

const PRICE_MAX = 100_000;
const PRICE_STEP = 500;
const MILEAGE_MAX = 150_000;
const MILEAGE_STEP = 5_000;
const AGE_MAX = 15;
const ENGINE_SIZE_MAX = 70;
const ENGINE_POWER_MAX = 700;
const BATTERY_RANGE_MAX = 500;
const CHARGING_TIME_MAX = 720;
const ACCELERATION_MAX = 20;
const FUEL_CONSUMPTION_MAX = 80;
const CO2_MAX = 300;
const TAX_MAX = 600;
const INSURANCE_GROUP_MAX = 50;
const BOOT_SPACE_MAX = 2500;
const LOCATION_OPTIONS = ["Isle of Man", "UK"] as const;

function parseNum(s: string | undefined, fallback: number): number {
  if (!s) return fallback;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? fallback : n;
}

function parseFloat2(s: string | undefined, fallback: number): number {
  if (!s) return fallback;
  const n = parseFloat(s);
  return Number.isNaN(n) ? fallback : n;
}

export function AdvancedSearchModal({
  open,
  onOpenChange,
  makes,
  modelsByMake,
  categories = [],
  regions = [],
  initial,
  onApply,
}: AdvancedSearchModalProps) {
  const [make, setMake] = React.useState(initial.make ?? "");
  const [model, setModel] = React.useState(initial.model ?? "");
  const [keyword, setKeyword] = React.useState(initial.q ?? "");
  const [category, setCategory] = React.useState(initial.category ?? "");
  const [region, setRegion] = React.useState(initial.region ?? "");
  const [bodyType, setBodyType] = React.useState(initial.bodyType ?? "");
  const [colour, setColour] = React.useState(initial.colour ?? "");
  const [fuelType, setFuelType] = React.useState(initial.fuelType ?? "");
  const [transmission, setTransmission] = React.useState(initial.transmission ?? "");
  const [driveType, setDriveType] = React.useState(initial.driveType ?? "");
  const [sellerType, setSellerType] = React.useState(initial.sellerType ?? "");
  const [location, setLocation] = React.useState(initial.location ?? "");
  const [doors, setDoors] = React.useState(initial.doors ?? "");
  const [seats, setSeats] = React.useState(initial.seats ?? "");

  const [priceRange, setPriceRange] = React.useState<[number, number]>([
    parseNum(initial.minPrice, 0), parseNum(initial.maxPrice, PRICE_MAX),
  ]);
  const [mileageRange, setMileageRange] = React.useState<[number, number]>([
    parseNum(initial.minMileage, 0), parseNum(initial.maxMileage, MILEAGE_MAX),
  ]);
  const [ageRange, setAgeRange] = React.useState<[number, number]>(
    yearRangeToAgeRange(initial.minYear, initial.maxYear),
  );
  const [engineSizeRange, setEngineSizeRange] = React.useState<[number, number]>([
    parseFloat2(initial.minEngineSize, 0), parseFloat2(initial.maxEngineSize, ENGINE_SIZE_MAX),
  ]);
  const [enginePowerRange, setEnginePowerRange] = React.useState<[number, number]>([
    parseNum(initial.minEnginePower, 0), parseNum(initial.maxEnginePower, ENGINE_POWER_MAX),
  ]);
  const [batteryRange, setBatteryRange] = React.useState<[number, number]>([
    parseNum(initial.minBatteryRange, 0), parseNum(initial.maxBatteryRange, BATTERY_RANGE_MAX),
  ]);
  const [chargingTimeRange, setChargingTimeRange] = React.useState<[number, number]>([
    parseNum(initial.minChargingTime, 0), parseNum(initial.maxChargingTime, CHARGING_TIME_MAX),
  ]);
  const [accelerationRange, setAccelerationRange] = React.useState<[number, number]>([
    parseNum(initial.minAcceleration, 0), parseNum(initial.maxAcceleration, ACCELERATION_MAX),
  ]);
  const [fuelConsumptionRange, setFuelConsumptionRange] = React.useState<[number, number]>([
    parseNum(initial.minFuelConsumption, 0), parseNum(initial.maxFuelConsumption, FUEL_CONSUMPTION_MAX),
  ]);
  const [co2Range, setCo2Range] = React.useState<[number, number]>([
    parseNum(initial.minCo2, 0), parseNum(initial.maxCo2, CO2_MAX),
  ]);
  const [taxRange, setTaxRange] = React.useState<[number, number]>([
    parseNum(initial.minTax, 0), parseNum(initial.maxTax, TAX_MAX),
  ]);
  const [insuranceGroupRange, setInsuranceGroupRange] = React.useState<[number, number]>([
    parseNum(initial.minInsuranceGroup, 1), parseNum(initial.maxInsuranceGroup, INSURANCE_GROUP_MAX),
  ]);
  const [bootSpaceRange, setBootSpaceRange] = React.useState<[number, number]>([
    parseNum(initial.minBootSpace, 0), parseNum(initial.maxBootSpace, BOOT_SPACE_MAX),
  ]);

  React.useEffect(() => {
    if (!open) return;
    setMake(initial.make ?? "");
    setModel(initial.model ?? "");
    setKeyword(initial.q ?? "");
    setCategory(initial.category ?? "");
    setRegion(initial.region ?? "");
    setBodyType(initial.bodyType ?? "");
    setColour(initial.colour ?? "");
    setFuelType(initial.fuelType ?? "");
    setTransmission(initial.transmission ?? "");
    setDriveType(initial.driveType ?? "");
    setSellerType(initial.sellerType ?? "");
    setLocation(initial.location ?? "");
    setDoors(initial.doors ?? "");
    setSeats(initial.seats ?? "");
    setPriceRange([parseNum(initial.minPrice, 0), parseNum(initial.maxPrice, PRICE_MAX)]);
    setMileageRange([parseNum(initial.minMileage, 0), parseNum(initial.maxMileage, MILEAGE_MAX)]);
    setAgeRange(yearRangeToAgeRange(initial.minYear, initial.maxYear));
    setEngineSizeRange([parseFloat2(initial.minEngineSize, 0), parseFloat2(initial.maxEngineSize, ENGINE_SIZE_MAX)]);
    setEnginePowerRange([parseNum(initial.minEnginePower, 0), parseNum(initial.maxEnginePower, ENGINE_POWER_MAX)]);
    setBatteryRange([parseNum(initial.minBatteryRange, 0), parseNum(initial.maxBatteryRange, BATTERY_RANGE_MAX)]);
    setChargingTimeRange([parseNum(initial.minChargingTime, 0), parseNum(initial.maxChargingTime, CHARGING_TIME_MAX)]);
    setAccelerationRange([parseNum(initial.minAcceleration, 0), parseNum(initial.maxAcceleration, ACCELERATION_MAX)]);
    setFuelConsumptionRange([parseNum(initial.minFuelConsumption, 0), parseNum(initial.maxFuelConsumption, FUEL_CONSUMPTION_MAX)]);
    setCo2Range([parseNum(initial.minCo2, 0), parseNum(initial.maxCo2, CO2_MAX)]);
    setTaxRange([parseNum(initial.minTax, 0), parseNum(initial.maxTax, TAX_MAX)]);
    setInsuranceGroupRange([parseNum(initial.minInsuranceGroup, 1), parseNum(initial.maxInsuranceGroup, INSURANCE_GROUP_MAX)]);
    setBootSpaceRange([parseNum(initial.minBootSpace, 0), parseNum(initial.maxBootSpace, BOOT_SPACE_MAX)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const modelsForMake = make ? (modelsByMake[make] ?? []) : [];

  function rangeParam(v: number, dflt: number, max: number): string | undefined {
    if (v === dflt) return undefined;
    if (v >= max) return undefined;
    return String(v);
  }

  function rangeMinParam(v: number, dflt: number): string | undefined {
    return v > dflt ? String(v) : undefined;
  }

  function rangeMaxParam(v: number, max: number): string | undefined {
    return v < max ? String(v) : undefined;
  }

  function handleApply() {
    const isAgeDefault = ageRange[0] === 0 && ageRange[1] >= AGE_MAX;
    const yearParams = isAgeDefault
      ? { minYear: undefined, maxYear: undefined }
      : {
          minYear: ageRangeToYearRange(ageRange).minYear || undefined,
          maxYear: ageRangeToYearRange(ageRange).maxYear || undefined,
        };

    onApply({
      q: keyword || undefined,
      make: make || undefined,
      model: model || undefined,
      category: category || undefined,
      region: region || undefined,
      bodyType: bodyType || undefined,
      colour: colour || undefined,
      fuelType: fuelType || undefined,
      transmission: transmission || undefined,
      driveType: driveType || undefined,
      sellerType: sellerType || undefined,
      location: location || undefined,
      doors: doors || undefined,
      seats: seats || undefined,
      minPrice: rangeMinParam(priceRange[0], 0),
      maxPrice: rangeMaxParam(priceRange[1], PRICE_MAX),
      minMileage: rangeMinParam(mileageRange[0], 0),
      maxMileage: rangeMaxParam(mileageRange[1], MILEAGE_MAX),
      minYear: yearParams.minYear,
      maxYear: yearParams.maxYear,
      minEngineSize: rangeMinParam(engineSizeRange[0], 0),
      maxEngineSize: rangeMaxParam(engineSizeRange[1], ENGINE_SIZE_MAX),
      minEnginePower: rangeMinParam(enginePowerRange[0], 0),
      maxEnginePower: rangeMaxParam(enginePowerRange[1], ENGINE_POWER_MAX),
      minBatteryRange: rangeMinParam(batteryRange[0], 0),
      maxBatteryRange: rangeMaxParam(batteryRange[1], BATTERY_RANGE_MAX),
      minChargingTime: rangeMinParam(chargingTimeRange[0], 0),
      maxChargingTime: rangeMaxParam(chargingTimeRange[1], CHARGING_TIME_MAX),
      minAcceleration: rangeMinParam(accelerationRange[0], 0),
      maxAcceleration: rangeMaxParam(accelerationRange[1], ACCELERATION_MAX),
      minFuelConsumption: rangeMinParam(fuelConsumptionRange[0], 0),
      maxFuelConsumption: rangeMaxParam(fuelConsumptionRange[1], FUEL_CONSUMPTION_MAX),
      minCo2: rangeMinParam(co2Range[0], 0),
      maxCo2: rangeMaxParam(co2Range[1], CO2_MAX),
      minTax: rangeMinParam(taxRange[0], 0),
      maxTax: rangeMaxParam(taxRange[1], TAX_MAX),
      minInsuranceGroup: rangeMinParam(insuranceGroupRange[0], 1),
      maxInsuranceGroup: rangeMaxParam(insuranceGroupRange[1], INSURANCE_GROUP_MAX),
      minBootSpace: rangeMinParam(bootSpaceRange[0], 0),
      maxBootSpace: rangeMaxParam(bootSpaceRange[1], BOOT_SPACE_MAX),
    });
    onOpenChange(false);
  }

  const selectTriggerClass = "h-10 text-sm";

  function SelectField({
    label,
    value,
    onChange,
    options,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: readonly string[] | readonly { label: string; value: string }[];
  }) {
    return (
      <div>
        <label className="mb-1 block text-xs font-medium text-text-secondary">{label}</label>
        <Select
          value={value || "any"}
          onValueChange={(v) => onChange(v === "any" ? "" : v)}
        >
          <SelectTrigger className={selectTriggerClass}>
            <SelectValue placeholder="Any" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any</SelectItem>
            {options.map((opt) => {
              const val = typeof opt === "string" ? opt : opt.value;
              const lbl = typeof opt === "string" ? opt : opt.label;
              if (!val) return null;
              return <SelectItem key={val} value={val}>{lbl}</SelectItem>;
            })}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Advanced Search</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* --- Vehicle --- */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-text-primary border-b border-border pb-2">Vehicle</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">Make</label>
                <Select
                  value={make || "any"}
                  onValueChange={(v) => { setMake(v === "any" ? "" : v); setModel(""); }}
                >
                  <SelectTrigger className={selectTriggerClass}>
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    {makes.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">Model</label>
                <Select
                  value={model || "any"}
                  onValueChange={(v) => setModel(v === "any" ? "" : v)}
                  disabled={!make}
                >
                  <SelectTrigger className={selectTriggerClass} aria-disabled={!make}>
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    {modelsForMake.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <SelectField label="Body Type" value={bodyType} onChange={setBodyType} options={BODY_TYPE_OPTIONS} />
              <SelectField label="Colour" value={colour} onChange={setColour} options={COLOUR_OPTIONS} />
              <SelectField label="Doors" value={doors} onChange={setDoors} options={DOORS_OPTIONS.map((d) => String(d))} />
              <SelectField label="Seats" value={seats} onChange={setSeats} options={SEATS_OPTIONS.map((s) => String(s))} />
              <SelectField label="Gearbox" value={transmission} onChange={setTransmission} options={TRANSMISSION_OPTIONS} />
              <SelectField label="Fuel Type" value={fuelType} onChange={setFuelType} options={FUEL_TYPE_OPTIONS} />
              <SelectField label="Drive Type" value={driveType} onChange={setDriveType} options={DRIVE_TYPE_OPTIONS} />
              <SelectField label="Seller Type" value={sellerType} onChange={setSellerType} options={SELLER_TYPE_OPTIONS} />
              <SelectField label="Location" value={location} onChange={setLocation} options={LOCATION_OPTIONS} />
            </div>
          </section>

          {/* --- Price & Mileage --- */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-text-primary border-b border-border pb-2">Price, Mileage &amp; Age</h3>
            <div className="space-y-4">
              <RangeSlider label="Price" min={0} max={PRICE_MAX} step={PRICE_STEP} value={priceRange} onValueChange={setPriceRange} formatValue={(v) => `£${v.toLocaleString()}`} />
              <RangeSlider label="Mileage" min={0} max={MILEAGE_MAX} step={MILEAGE_STEP} value={mileageRange} onValueChange={setMileageRange} formatValue={(v) => `${v.toLocaleString()} mi`} />
              <RangeSlider label="Age" min={0} max={AGE_MAX} step={1} value={ageRange} onValueChange={setAgeRange} formatValue={(v) => v === 1 ? "1 year" : `${v} years`} />
            </div>
          </section>

          {/* --- Performance --- */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-text-primary border-b border-border pb-2">Performance</h3>
            <div className="space-y-4">
              <RangeSlider label="Engine Size" min={0} max={ENGINE_SIZE_MAX} step={1} value={engineSizeRange} onValueChange={setEngineSizeRange} formatValue={(v) => `${(v / 10).toFixed(1)}L`} />
              <RangeSlider label="Engine Power" min={0} max={ENGINE_POWER_MAX} step={10} value={enginePowerRange} onValueChange={setEnginePowerRange} formatValue={(v) => `${v} bhp`} />
              <RangeSlider label="Acceleration (0-62mph)" min={0} max={ACCELERATION_MAX} step={1} value={accelerationRange} onValueChange={setAccelerationRange} formatValue={(v) => `${v}s`} />
            </div>
          </section>

          {/* --- Running Costs --- */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-text-primary border-b border-border pb-2">Running Costs</h3>
            <div className="space-y-4">
              <RangeSlider label="Fuel Consumption" min={0} max={FUEL_CONSUMPTION_MAX} step={1} value={fuelConsumptionRange} onValueChange={setFuelConsumptionRange} formatValue={(v) => `${v} mpg`} />
              <RangeSlider label="CO2 Emissions" min={0} max={CO2_MAX} step={5} value={co2Range} onValueChange={setCo2Range} formatValue={(v) => `${v} g/km`} />
              <RangeSlider label="Tax Per Year" min={0} max={TAX_MAX} step={10} value={taxRange} onValueChange={setTaxRange} formatValue={(v) => `£${v}`} />
              <RangeSlider label="Insurance Group" min={1} max={INSURANCE_GROUP_MAX} step={1} value={insuranceGroupRange} onValueChange={setInsuranceGroupRange} formatValue={(v) => String(v)} />
            </div>
          </section>

          {/* --- EV --- */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-text-primary border-b border-border pb-2">Electric Vehicle</h3>
            <div className="space-y-4">
              <RangeSlider label="Battery Range" min={0} max={BATTERY_RANGE_MAX} step={10} value={batteryRange} onValueChange={setBatteryRange} formatValue={(v) => `${v} mi`} />
              <RangeSlider label="Charging Time" min={0} max={CHARGING_TIME_MAX} step={10} value={chargingTimeRange} onValueChange={setChargingTimeRange} formatValue={(v) => v >= 60 ? `${Math.floor(v / 60)}h ${v % 60}m` : `${v}m`} />
            </div>
          </section>

          {/* --- Other --- */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-text-primary border-b border-border pb-2">Other</h3>
            <div className="space-y-4">
              <RangeSlider label="Boot Space" min={0} max={BOOT_SPACE_MAX} step={50} value={bootSpaceRange} onValueChange={setBootSpaceRange} formatValue={(v) => `${v}L`} />

              {categories.length > 0 && (
                <SelectField label="Category" value={category} onChange={setCategory} options={categories} />
              )}
              {regions.length > 0 && (
                <SelectField label="Region" value={region} onChange={setRegion} options={regions} />
              )}

              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">Keyword (e.g. sunroof, heated seats)</label>
                <SearchBar
                  value={keyword}
                  onValueChange={setKeyword}
                  placeholder="Search by keyword..."
                />
              </div>
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleApply}>
            Apply Filters
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
