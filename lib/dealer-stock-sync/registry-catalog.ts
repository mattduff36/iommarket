export interface DealerStockRegistryOption {
  key: string;
  label: string;
}

/** Confirmed registry sources. Labels are display-only; binding never uses the dealer name. */
export const DEALER_STOCK_REGISTRY_OPTIONS = [
  { key: "athol-garage", label: "Athol Garage" },
  { key: "bcc-cars", label: "BCC Cars" },
  { key: "bespoke-vehicle-sales", label: "Bespoke Vehicle Sales" },
  { key: "best-cars", label: "Best Cars" },
  { key: "bettridge-motors", label: "Bettridge Motors" },
  { key: "brent-mealin", label: "Brent Mealin" },
  { key: "budget-cars-isle-of-man", label: "Budget Cars Isle of Man" },
  { key: "bvs-vehicles", label: "BVS Vehicles" },
  { key: "carshop", label: "Carshop" },
  { key: "cars-4-you", label: "Cars 4 You" },
  { key: "dw-cars", label: "DW Cars" },
  { key: "franklins", label: "Franklins" },
  { key: "im1-car-centre", label: "iM1 Car Centre" },
  { key: "ingear-car-sales", label: "Ingear Car Sales" },
  { key: "kingswood-honda", label: "Kingswood Honda" },
  { key: "manx-car-store", label: "Manx Car Store" },
  { key: "manx-car-warehouse", label: "Manx Car Warehouse" },
  { key: "mikes-motors", label: "Mike's Motors" },
  { key: "motorx", label: "MotorX" },
  { key: "ocean-motor-village", label: "Ocean Motor Village" },
  { key: "paul-ridgway", label: "Paul Ridgway" },
  { key: "phil-shaw-vehicles", label: "Phil Shaw Vehicles" },
  { key: "select-car-sales", label: "Select Car Sales" },
  { key: "skillannaylor-car-company", label: "SkillanNaylor Car Company" },
  { key: "swift-motors", label: "Swift Motors" },
  { key: "td-car-centre", label: "TD Car Centre" },
  { key: "van-mossel-jacksons", label: "Van Mossel Jacksons" },
  { key: "van-mossel-motor-mall", label: "Van Mossel Motor Mall" },
  { key: "vehicles-im", label: "Vehicles.im" },
] as const satisfies readonly DealerStockRegistryOption[];

export function getDealerStockRegistryOption(key: string) {
  return DEALER_STOCK_REGISTRY_OPTIONS.find((option) => option.key === key) ?? null;
}
