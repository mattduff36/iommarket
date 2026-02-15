/**
 * Shared price range and age options for hero search and more-options modal.
 * URL/search still use minPrice, maxPrice, minYear, maxYear.
 */

export const PRICE_RANGE_OPTIONS = [
  { label: "Any", value: "" },
  { label: "Under £1,000", value: "0-1000" },
  { label: "£1,000 - £3,000", value: "1000-3000" },
  { label: "£3,000 - £6,000", value: "3000-6000" },
  { label: "£6,000 - £10,000", value: "6000-10000" },
  { label: "£10,000 - £15,000", value: "10000-15000" },
  { label: "£15,000 - £20,000", value: "15000-20000" },
  { label: "£20,000 - £25,000", value: "20000-25000" },
  { label: "£25,000 - £30,000", value: "25000-30000" },
  { label: "£30,000 - £50,000", value: "30000-50000" },
  { label: "£50,000+", value: "50000-999999" },
];

export const MAX_AGE_OPTIONS = (() => {
  const options = [{ label: "Any", value: "" }];
  for (let age = 1; age <= 15; age++) {
    options.push({
      label: age === 1 ? "1 year old" : `${age} years old`,
      value: String(age),
    });
  }
  return options;
})();

export function priceRangeToMinMax(value: string): { minPrice: string; maxPrice: string } {
  if (!value) return { minPrice: "", maxPrice: "" };
  const [min, max] = value.split("-").map((s) => s?.trim() ?? "");
  return { minPrice: min ?? "", maxPrice: max ?? "" };
}

export function minMaxToPriceRange(minPrice: string, maxPrice: string): string {
  if (!minPrice && !maxPrice) return "";
  const key = `${minPrice || "0"}-${maxPrice || "999999"}`;
  const match = PRICE_RANGE_OPTIONS.find((o) => o.value === key);
  return match ? match.value : key;
}

export function ageToYearRange(ageValue: string): { minYear: string; maxYear: string } {
  if (!ageValue) return { minYear: "", maxYear: "" };
  const age = parseInt(ageValue, 10);
  if (Number.isNaN(age) || age < 1) return { minYear: "", maxYear: "" };
  const currentYear = new Date().getFullYear();
  return {
    minYear: String(currentYear - age),
    maxYear: String(currentYear),
  };
}

export function yearRangeToAge(minYear: string, maxYear: string): string {
  if (!minYear && !maxYear) return "";
  const currentYear = new Date().getFullYear();
  const max = maxYear ? parseInt(maxYear, 10) : currentYear;
  if (Number.isNaN(max) || max !== currentYear) return "";
  const min = minYear ? parseInt(minYear, 10) : currentYear - 15;
  if (Number.isNaN(min)) return "";
  const age = currentYear - min;
  return age >= 1 && age <= 15 ? String(age) : "";
}
