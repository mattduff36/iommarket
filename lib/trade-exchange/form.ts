export function checked(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === "on" || value === "true";
}

export function poundsToPence(value: string): number | "" {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return Number.NaN;
  const [whole, fraction = ""] = trimmed.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function listingInputFromForm(formData: FormData) {
  return {
    make: formData.get("make"),
    model: formData.get("model"),
    year: formData.get("year"),
    mileage: formData.get("mileage"),
    transmission: formData.get("transmission"),
    fuel: formData.get("fuel"),
    conditionSummary: formData.get("conditionSummary"),
    disclosedDefects: formData.get("disclosedDefects"),
    serviceHistory: formData.get("serviceHistory"),
    motStatus: formData.get("motStatus"),
    priceType: formData.get("priceType"),
    pricePence: poundsToPence(String(formData.get("priceGbp") ?? "")),
    vatTreatment: formData.get("vatTreatment"),
    registrationNumber: formData.get("registrationNumber"),
    vin: formData.get("vin"),
    locationLabel: formData.get("locationLabel"),
    notes: formData.get("notes"),
    contactPreference: formData.get("contactPreference"),
    availabilityNote: formData.get("availabilityNote"),
    ownershipDeclared: checked(formData, "ownershipDeclared"),
    authorityDeclared: checked(formData, "authorityDeclared"),
    mileageDeclared: checked(formData, "mileageDeclared"),
    conditionDeclared: checked(formData, "conditionDeclared"),
    notWrittenOffDeclared: checked(formData, "notWrittenOffDeclared"),
    writeOff: formData.get("writeOff") || "NONE",
  };
}

export function searchInputFromForm(formData: FormData) {
  return {
    make: formData.get("make") ?? "",
    model: formData.get("model") ?? "",
    minPrice: poundsToPence(String(formData.get("minPriceGbp") ?? "")),
    maxPrice: poundsToPence(String(formData.get("maxPriceGbp") ?? "")),
    minYear: formData.get("minYear") ?? "",
    maxYear: formData.get("maxYear") ?? "",
    minMileage: formData.get("minMileage") ?? "",
    maxMileage: formData.get("maxMileage") ?? "",
    transmission: formData.get("transmission") ?? "",
    fuel: formData.get("fuel") ?? "",
    dealerId: formData.get("dealerId") ?? "",
    condition: formData.get("condition") ?? "",
    sort: "newest",
  };
}
