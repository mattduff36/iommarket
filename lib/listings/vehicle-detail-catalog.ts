export const YES_NO_UNKNOWN = ["Yes", "No", "Unknown"] as const;

export const PUBLIC_OMITTED_ATTRIBUTE_VALUES = new Set([
  "Unknown",
  "Not checked/Unknown",
]);

export const EARLIEST_RECORDED_CHECK = "1970-01-01";

export const MOTORHOME_BODY_TYPES = [
  "Campervan/van conversion",
  "Low-profile coachbuilt",
  "Overcab coachbuilt",
  "A-class",
  "Other",
] as const;

export const VAN_BODY_TYPES = [
  "Panel van",
  "Crew van/double cab",
  "Minibus",
  "Pickup",
  "Dropside",
  "Tipper",
  "Luton/box van",
  "Chassis cab",
  "Refrigerated van",
  "Other",
] as const;

export const MOTORHOME_SLEEPING_LAYOUTS = [
  "Fixed double",
  "Island bed",
  "Fixed twin/singles",
  "Bunk beds",
  "Drop-down bed",
  "Overcab bed",
  "Convertible lounge",
  "Other",
] as const;

export const MOTORHOME_MAIN_LAYOUTS = [
  "Rear lounge",
  "Rear bedroom",
  "Rear kitchen",
  "Rear washroom",
  "Other",
] as const;

export const VAN_WHEELBASES = [
  "Short",
  "Medium",
  "Long",
  "Extra-long",
  "Unknown",
] as const;

export const VAN_ROOF_HEIGHTS = [
  "Low",
  "Medium",
  "High",
  "Extra-high",
  "Unknown",
] as const;

export const VAN_SLIDING_DOORS = [
  "None",
  "Left",
  "Right",
  "Both sides",
  "Unknown",
] as const;

export const VAN_REAR_DOORS = ["Barn doors", "Tailgate", "Other", "Unknown"] as const;

export const DAMP_RESULTS = [
  "No issues reported",
  "Issues reported",
  "Not checked/Unknown",
] as const;

const TRI_STATE_HELPER =
  "Choose Unknown if this is not known. Unknown is stored as Unknown and is not treated as No.";

const WEIGHT_HELPER =
  "Kilograms as stated. This does not calculate a payload or assess licence entitlement.";

function triState(
  name: string,
  slug: string,
  sortOrder: number,
  group = "facilities",
): VehicleDetailAttribute {
  return {
    name,
    slug,
    dataType: "select",
    sortOrder,
    group,
    options: YES_NO_UNKNOWN,
    helperText: TRI_STATE_HELPER,
  };
}

const METRES = { dataType: "number", min: 0.5, max: 20, step: 0.01 } as const;
const KILOGRAMS = { dataType: "number", min: 1, max: 50_000, step: 1 } as const;
const KILOGRAMS_FROM_ZERO = { dataType: "number", min: 0, max: 50_000, step: 1 } as const;

export interface VehicleDetailAttribute {
  name: string;
  slug: string;
  dataType: "text" | "number" | "select" | "date";
  sortOrder: number;
  group: string;
  options?: readonly string[];
  helperText?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  showWhen?: { slug: string; equals: "Yes" };
}

export interface VehicleDetailGroup {
  id: string;
  title: string;
}

export const VEHICLE_DETAIL_GROUPS: Record<string, readonly VehicleDetailGroup[]> = {
  motorhome: [
    { id: "habitation", title: "Habitation" },
    { id: "dimensions", title: "Dimensions and weights" },
    { id: "base-vehicle", title: "Base vehicle and checks" },
    { id: "facilities", title: "Facilities" },
  ],
  van: [
    { id: "size", title: "Size" },
    { id: "dimensions", title: "Dimensions" },
    { id: "weights", title: "Weights and towing" },
    { id: "load-area", title: "Load area" },
  ],
};

const MOTORHOME_DETAIL_ATTRIBUTES: readonly VehicleDetailAttribute[] = [
  {
    name: "Sleeping berths",
    slug: "sleeping-berths",
    dataType: "number",
    sortOrder: 40,
    group: "habitation",
    min: 0,
    max: 16,
    step: 1,
    placeholder: "e.g. 4",
  },
  {
    name: "Belted travelling seats",
    slug: "belted-travelling-seats",
    dataType: "number",
    sortOrder: 41,
    group: "habitation",
    min: 0,
    max: 16,
    step: 1,
    placeholder: "e.g. 4",
    helperText: "Seats with belts for travelling. Separate from the general seats field.",
  },
  {
    name: "Sleeping layout",
    slug: "sleeping-layout",
    dataType: "select",
    sortOrder: 42,
    group: "habitation",
    options: MOTORHOME_SLEEPING_LAYOUTS,
    helperText: "Primary layout only. One layout is stored.",
  },
  {
    name: "Main layout",
    slug: "main-layout",
    dataType: "select",
    sortOrder: 43,
    group: "habitation",
    options: MOTORHOME_MAIN_LAYOUTS,
  },
  {
    name: "Overall length (m)",
    slug: "overall-length-m",
    ...METRES,
    sortOrder: 50,
    group: "dimensions",
    placeholder: "e.g. 7.20",
    helperText: "Metres.",
  },
  {
    name: "Overall width excluding mirrors (m)",
    slug: "overall-width-m",
    ...METRES,
    sortOrder: 51,
    group: "dimensions",
    placeholder: "e.g. 2.35",
    helperText: "Metres. Do not include mirrors.",
  },
  {
    name: "Overall height (m)",
    slug: "overall-height-m",
    ...METRES,
    sortOrder: 52,
    group: "dimensions",
    placeholder: "e.g. 2.90",
    helperText: "Metres.",
  },
  {
    name: "Maximum laden weight MTPLM/MAM (kg)",
    slug: "mtplm-kg",
    ...KILOGRAMS,
    sortOrder: 53,
    group: "dimensions",
    placeholder: "e.g. 3500",
    helperText: WEIGHT_HELPER,
  },
  {
    name: "Mass in running order MRO (kg)",
    slug: "mro-kg",
    ...KILOGRAMS,
    sortOrder: 54,
    group: "dimensions",
    placeholder: "e.g. 3100",
    helperText: WEIGHT_HELPER,
  },
  {
    name: "Stated payload (kg)",
    slug: "stated-payload-kg",
    ...KILOGRAMS_FROM_ZERO,
    sortOrder: 55,
    group: "dimensions",
    placeholder: "e.g. 400",
    helperText: "Seller-stated kilograms. Not a calculated payload and not a licence assessment.",
  },
  {
    name: "Base vehicle make",
    slug: "base-vehicle-make",
    dataType: "text",
    sortOrder: 60,
    group: "base-vehicle",
    maxLength: 80,
    placeholder: "e.g. Fiat",
    helperText: "Chassis or base vehicle, separate from the motorhome manufacturer.",
  },
  {
    name: "Base vehicle model",
    slug: "base-vehicle-model",
    dataType: "text",
    sortOrder: 61,
    group: "base-vehicle",
    maxLength: 80,
    placeholder: "e.g. Ducato",
    helperText: "Base vehicle model, separate from the motorhome model.",
  },
  {
    name: "Last habitation check",
    slug: "last-habitation-check",
    dataType: "date",
    sortOrder: 62,
    group: "base-vehicle",
    helperText: "Date of the last habitation check, if known.",
  },
  {
    name: "Last damp check",
    slug: "last-damp-check",
    dataType: "date",
    sortOrder: 63,
    group: "base-vehicle",
    helperText: "Date of the last damp check, if known.",
  },
  {
    name: "Damp check result",
    slug: "damp-result",
    dataType: "select",
    sortOrder: 64,
    group: "base-vehicle",
    options: DAMP_RESULTS,
    helperText: "Seller-reported result. Not checked/Unknown is not the same as no issues.",
  },
  {
    name: "Reported issues notes",
    slug: "reported-issues-notes",
    dataType: "text",
    sortOrder: 65,
    group: "base-vehicle",
    maxLength: 400,
    placeholder: "Short seller-reported notes",
    helperText: "Seller-reported only. This is not an inspection report.",
  },
  triState("Toilet", "toilet", 70),
  triState("Shower", "shower", 71),
  triState("Heating", "heating", 72),
  {
    name: "Heating type",
    slug: "heating-type",
    dataType: "text",
    sortOrder: 73,
    group: "facilities",
    maxLength: 80,
    placeholder: "e.g. Gas and electric",
    showWhen: { slug: "heating", equals: "Yes" },
  },
  triState("Solar", "solar", 74),
  {
    name: "Solar output (W)",
    slug: "solar-output-w",
    dataType: "number",
    sortOrder: 75,
    group: "facilities",
    min: 1,
    max: 10_000,
    step: 1,
    placeholder: "e.g. 200",
    showWhen: { slug: "solar", equals: "Yes" },
  },
  {
    ...triState("Leisure battery", "leisure-battery", 76),
    helperText: `${TRI_STATE_HELPER} This is the leisure battery, not the traction or starter battery.`,
  },
  {
    name: "Leisure battery capacity (Ah)",
    slug: "leisure-battery-ah",
    dataType: "number",
    sortOrder: 77,
    group: "facilities",
    min: 1,
    max: 5_000,
    step: 1,
    placeholder: "e.g. 100",
    helperText: "Leisure battery capacity, not the traction battery.",
    showWhen: { slug: "leisure-battery", equals: "Yes" },
  },
  {
    name: "Fresh water (litres)",
    slug: "fresh-water-litres",
    dataType: "number",
    sortOrder: 78,
    group: "facilities",
    min: 0,
    max: 2_000,
    step: 1,
    placeholder: "e.g. 90",
  },
  {
    name: "Waste water (litres)",
    slug: "waste-water-litres",
    dataType: "number",
    sortOrder: 79,
    group: "facilities",
    min: 0,
    max: 2_000,
    step: 1,
    placeholder: "e.g. 90",
  },
  triState("Awning", "awning", 80),
  triState("Rear garage or storage", "rear-garage", 81),
];

const VAN_DETAIL_ATTRIBUTES: readonly VehicleDetailAttribute[] = [
  {
    name: "Wheelbase",
    slug: "wheelbase",
    dataType: "select",
    sortOrder: 40,
    group: "size",
    options: VAN_WHEELBASES,
  },
  {
    name: "Roof height",
    slug: "roof-height",
    dataType: "select",
    sortOrder: 41,
    group: "size",
    options: VAN_ROOF_HEIGHTS,
  },
  {
    name: "Manufacturer size designation",
    slug: "manufacturer-size-designation",
    dataType: "text",
    sortOrder: 42,
    group: "size",
    maxLength: 20,
    placeholder: "e.g. L2H2",
    helperText: "Manufacturer code only, for example L2H2. Dimensions are not calculated from this code.",
  },
  {
    name: "Overall length (m)",
    slug: "overall-length-m",
    ...METRES,
    sortOrder: 50,
    group: "dimensions",
    placeholder: "e.g. 5.40",
    helperText: "Metres.",
  },
  {
    name: "Overall width excluding mirrors (m)",
    slug: "overall-width-m",
    ...METRES,
    sortOrder: 51,
    group: "dimensions",
    placeholder: "e.g. 2.05",
    helperText: "Metres. Do not include mirrors.",
  },
  {
    name: "Overall height (m)",
    slug: "overall-height-m",
    ...METRES,
    sortOrder: 52,
    group: "dimensions",
    placeholder: "e.g. 2.50",
    helperText: "Metres.",
  },
  {
    name: "Load space length (m)",
    slug: "load-length-m",
    ...METRES,
    sortOrder: 53,
    group: "dimensions",
    placeholder: "e.g. 2.90",
    helperText: "Metres.",
  },
  {
    name: "Load space width (m)",
    slug: "load-width-m",
    ...METRES,
    sortOrder: 54,
    group: "dimensions",
    placeholder: "e.g. 1.80",
    helperText: "Metres.",
  },
  {
    name: "Load space height (m)",
    slug: "load-height-m",
    ...METRES,
    sortOrder: 55,
    group: "dimensions",
    placeholder: "e.g. 1.70",
    helperText: "Metres.",
  },
  {
    name: "Width between wheel arches (m)",
    slug: "width-between-wheel-arches-m",
    ...METRES,
    sortOrder: 56,
    group: "dimensions",
    placeholder: "e.g. 1.25",
    helperText: "Metres.",
  },
  {
    name: "Load volume (m3)",
    slug: "load-volume-m3",
    dataType: "number",
    sortOrder: 57,
    group: "dimensions",
    min: 0.1,
    max: 200,
    step: 0.01,
    placeholder: "e.g. 8.50",
    helperText: "Cubic metres.",
  },
  {
    name: "Gross vehicle weight (kg)",
    slug: "gvw-kg",
    ...KILOGRAMS,
    sortOrder: 60,
    group: "weights",
    placeholder: "e.g. 3500",
    helperText: WEIGHT_HELPER,
  },
  {
    name: "Payload (kg)",
    slug: "payload-kg",
    ...KILOGRAMS_FROM_ZERO,
    sortOrder: 61,
    group: "weights",
    placeholder: "e.g. 1200",
    helperText: "Seller-stated kilograms. Not a calculated payload and not a licence assessment.",
  },
  {
    name: "Braked towing capacity (kg)",
    slug: "braked-towing-kg",
    ...KILOGRAMS_FROM_ZERO,
    sortOrder: 62,
    group: "weights",
    placeholder: "e.g. 2500",
    helperText: "Braked figure only, in kilograms. Not a licence assessment.",
  },
  {
    name: "Unbraked towing capacity (kg)",
    slug: "unbraked-towing-kg",
    ...KILOGRAMS_FROM_ZERO,
    sortOrder: 63,
    group: "weights",
    placeholder: "e.g. 750",
    helperText: "Unbraked figure only, in kilograms. Separate from the braked figure.",
  },
  {
    name: "Sliding doors",
    slug: "sliding-doors",
    dataType: "select",
    sortOrder: 70,
    group: "load-area",
    options: VAN_SLIDING_DOORS,
  },
  {
    name: "Rear doors",
    slug: "rear-doors",
    dataType: "select",
    sortOrder: 71,
    group: "load-area",
    options: VAN_REAR_DOORS,
  },
  triState("Bulkhead", "bulkhead", 72, "load-area"),
  triState("Load lining", "load-lining", 73, "load-area"),
  triState("Racking", "racking", 74, "load-area"),
  triState("Tie-downs", "tie-downs", 75, "load-area"),
  triState("Security locks", "security-locks", 76, "load-area"),
  triState("Tail lift", "tail-lift", 77, "load-area"),
  {
    name: "Tail lift capacity (kg)",
    slug: "tail-lift-capacity-kg",
    ...KILOGRAMS,
    sortOrder: 78,
    group: "load-area",
    placeholder: "e.g. 500",
    helperText: "Kilograms. Enter this only when a tail lift is fitted.",
    showWhen: { slug: "tail-lift", equals: "Yes" },
  },
];

const DETAIL_ATTRIBUTES: Record<string, readonly VehicleDetailAttribute[]> = {
  motorhome: MOTORHOME_DETAIL_ATTRIBUTES,
  van: VAN_DETAIL_ATTRIBUTES,
};

export function vehicleDetailAttributes(
  categorySlug: string | undefined,
): readonly VehicleDetailAttribute[] {
  if (!categorySlug) return [];
  return DETAIL_ATTRIBUTES[categorySlug] ?? [];
}

export function findVehicleDetailAttribute(
  categorySlug: string | undefined,
  slug: string,
): VehicleDetailAttribute | undefined {
  return vehicleDetailAttributes(categorySlug).find((attribute) => attribute.slug === slug);
}

export function bodyTypePresentation(categorySlug: string | undefined): {
  name: string;
  options: readonly string[];
} | null {
  if (categorySlug === "motorhome") {
    return { name: "Motorhome type", options: MOTORHOME_BODY_TYPES };
  }
  if (categorySlug === "van") {
    return { name: "Body Type", options: VAN_BODY_TYPES };
  }
  return null;
}

export function partitionByDetailGroup<T>(
  categorySlug: string | undefined,
  items: readonly T[],
  slugOf: (item: T) => string,
): { essentials: T[]; groups: Array<VehicleDetailGroup & { items: T[] }> } {
  const groups = categorySlug ? VEHICLE_DETAIL_GROUPS[categorySlug] : undefined;
  if (!groups) return { essentials: [...items], groups: [] };

  const groupBySlug = new Map(
    vehicleDetailAttributes(categorySlug).map((attribute) => [attribute.slug, attribute.group]),
  );
  const grouped = new Map<string, T[]>(groups.map((group) => [group.id, []]));
  const essentials: T[] = [];
  for (const item of items) {
    const groupId = groupBySlug.get(slugOf(item));
    const bucket = groupId ? grouped.get(groupId) : undefined;
    if (bucket) bucket.push(item);
    else essentials.push(item);
  }

  return {
    essentials,
    groups: groups
      .map((group) => ({ ...group, items: grouped.get(group.id) ?? [] }))
      .filter((group) => group.items.length > 0),
  };
}

export function isPublicAttributeValueVisible(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && !PUBLIC_OMITTED_ATTRIBUTE_VALUES.has(trimmed);
}

export interface PublicSpecificationAttribute {
  slug: string;
  name: string;
  value: string;
  sortOrder: number;
}

export function groupPublicSpecifications(input: {
  categorySlug: string | undefined;
  attributes: readonly PublicSpecificationAttribute[];
}): Array<{ id: string; title: string | null; items: PublicSpecificationAttribute[] }> {
  const usesDetailPresentation =
    input.categorySlug === "motorhome" || input.categorySlug === "van";
  const visible = usesDetailPresentation
    ? input.attributes
        .filter((attribute) => isPublicAttributeValueVisible(attribute.value))
        .slice()
        .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
    : input.attributes.slice();
  const partitioned = partitionByDetailGroup(
    input.categorySlug,
    visible,
    (attribute) => attribute.slug,
  );
  const sections: Array<{ id: string; title: string | null; items: PublicSpecificationAttribute[] }> = [];
  if (partitioned.essentials.length > 0) {
    sections.push({ id: "essentials", title: null, items: partitioned.essentials });
  }
  for (const group of partitioned.groups) {
    sections.push({ id: group.id, title: group.title, items: group.items });
  }
  return sections;
}

export function maximumRecordedCheckDate(now = new Date()): string {
  const utc = now.toISOString().slice(0, 10);
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
  const later = utc > local ? utc : local;
  const [year, month, day] = later.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isManufacturerSizeDesignation(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 /-]{0,19}$/.test(value);
}

export function withRetainedSelectOption(
  options: readonly string[],
  retainedValue: string | undefined,
): string[] {
  const retained = retainedValue?.trim() ?? "";
  if (!retained || options.includes(retained)) return [...options];
  return [retained, ...options];
}
