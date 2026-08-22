import {
  asNumber,
  asRecord,
  asString,
  mapEngineSize,
  nested,
  nestedNumber,
  nestedString,
  normalizeImageUrl,
  poundsToPence,
  resolveMaybeUrl,
} from "../../json";

function collectImages(raw: Record<string, unknown>, origin?: string | null) {
  const urls: string[] = [];
  const main = asString(raw.mainImage) ?? asString(raw.image) ?? nestedString(raw, ["image", "url"]);
  if (main) urls.push(main);

  const collections = [
    raw.listingImages,
    raw.images,
    raw.gallery,
    raw.photos,
    nested(raw, ["media", "images"]),
  ];
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      if (typeof item === "string") urls.push(item);
      const record = asRecord(item);
      const url =
        asString(record?.url) ??
        asString(record?.src) ??
        asString(record?.large) ??
        asString(record?.original);
      if (url) urls.push(url);
    }
  }
  return urls
    .map((url) => resolveMaybeUrl(url, origin) ?? normalizeImageUrl(url))
    .filter((url): url is string => Boolean(url));
}

function parseSnowplowContext(raw: Record<string, unknown>) {
  const value = raw.snowplow_vehicle_context ?? raw.snowplowVehicleContext;
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return asRecord(value);
}

function resolvePrice(raw: Record<string, unknown>) {
  const price = asRecord(raw.price);
  const isPoa =
    raw.isPoa === true ||
    price?.isPoa === true ||
    asString(raw.priceStatus)?.toLowerCase() === "poa" ||
    asString(price?.status)?.toLowerCase() === "poa" ||
    asString(raw.price_now)?.toLowerCase() === "poa";
  const current =
    asNumber(price?.current) ??
    asNumber(raw.price_now_raw) ??
    asNumber(raw.priceNowRaw) ??
    asNumber(raw.price_now) ??
    asNumber(raw.price);
  if (isPoa || current == null) return { pricePence: null, isPoa: Boolean(isPoa || current == null) };
  if (current > 10_000_000) return { pricePence: Math.round(current), isPoa: false };
  return { pricePence: poundsToPence(current), isPoa: false };
}

export function extractSearchVehicles(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  const candidates = [
    record.vehicles,
    record.results,
    record.items,
    nested(record, ["data", "allVehicles"]),
    nested(record, ["data", "getAll"]),
    nested(record, ["data", "vehicles"]),
    nested(record, ["data", "results"]),
    nested(record, ["data", "items"]),
    record.data,
    nested(record, ["result", "vehicles"]),
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    const nestedRecord = asRecord(candidate);
    if (nestedRecord) {
      const nestedList = extractSearchVehicles(nestedRecord);
      if (nestedList.length > 0) return nestedList;
    }
  }
  return [];
}

export function extractTotalPages(payload: unknown, pageSizeHint = 0) {
  const record = asRecord(payload);
  if (!record) return pageSizeHint > 0 ? 1 : 0;
  const data = asRecord(record.data);
  const pagination = asRecord(record.pagination) ?? asRecord(record.meta) ?? record;
  const totalPages =
    asNumber(pagination?.totalPages) ??
    asNumber(pagination?.pages) ??
    asNumber(pagination?.pageCount);
  if (totalPages && totalPages > 0) return Math.round(totalPages);
  const total =
    asNumber(record.count) ??
    asNumber(data?.getCount) ??
    asNumber(pagination?.total) ??
    asNumber(pagination?.totalResults);
  const pageSize =
    asNumber(record.perPage) ??
    asNumber(pagination?.pageSize) ??
    asNumber(pagination?.limit) ??
    (pageSizeHint > 0 ? pageSizeHint : 24);
  if (total && pageSize) return Math.max(1, Math.ceil(total / pageSize));
  if (record.hasMoreResults === false) return 1;
  return pageSizeHint > 0 ? 1 : 0;
}

export function extractHasMoreResults(payload: unknown) {
  const record = asRecord(payload);
  return record?.hasMoreResults === true;
}

export interface ParsedNetDirectorVehicle {
  sourceVehicleId: string | null;
  registration: string | null;
  stockReference: string | null;
  detailUrl: string | null;
  make: string;
  model: string;
  derivative: string | null;
  year: number | null;
  mileage: number | null;
  pricePence: number | null;
  isPoa: boolean;
  locationName: string;
  vehicleType: string | null;
  description: string;
  imageUrls: string[];
  fuel: string | null;
  transmission: string | null;
  bodyType: string | null;
  colour: string | null;
  doors: number | null;
  seats: number | null;
  engineSize: number | null;
  enginePower: number | null;
}

export function parseNetDirectorVehicle(
  rawValue: unknown,
  origin?: string | null,
): ParsedNetDirectorVehicle | null {
  const raw = asRecord(rawValue);
  if (!raw) return null;
  const snowplow = parseSnowplowContext(raw);

  const make =
    asString(raw.manufacturer) ??
    asString(raw.make) ??
    asString(snowplow?.ve_ma) ??
    nestedString(raw, ["make", "name"]) ??
    "";
  const model =
    asString(raw.model) ?? nestedString(raw, ["model", "name"]) ?? asString(snowplow?.ve_mo) ?? "";
  if (!make && !model) return null;

  const registration =
    nestedString(raw, ["registration", "number"]) ??
    asString(raw.registration) ??
    asString(raw.reg);
  const isNew =
    raw.isNew === true ||
    snowplow?.ve_is_new === true ||
    asString(raw.condition)?.toLowerCase() === "new" ||
    Boolean(registration && /^NEW/i.test(registration));
  let year =
    asNumber(raw.productionYear) ??
    nestedNumber(raw, ["registration", "year"]) ??
    asNumber(raw.year) ??
    asNumber(raw.reg_year) ??
    asNumber(raw.model_year) ??
    asNumber(snowplow?.ve_mo_ye);
  if (year != null && year <= 0) year = null;
  if (year == null && isNew) year = new Date().getFullYear();
  const mileage =
    nestedNumber(raw, ["odometer", "value"]) ??
    asNumber(raw.mileage) ??
    asNumber(raw.odometer) ??
    asNumber(snowplow?.ve_mi);
  const price = resolvePrice(raw);

  return {
    sourceVehicleId:
      asString(raw.id) ??
      nestedString(raw, ["identifiers", "stockId"]) ??
      asString(raw.stockId) ??
      asString(raw.stock_number),
    registration,
    stockReference:
      nestedString(raw, ["identifiers", "stockId"]) ??
      asString(raw.stockNumber) ??
      asString(raw.stock_number) ??
      asString(raw.reference),
    detailUrl: resolveMaybeUrl(
      asString(raw.externalUrl) ?? asString(raw.url) ?? asString(raw.detailUrl),
      origin,
    ),
    make,
    model,
    derivative:
      asString(raw.variant) ??
      asString(raw.derivative) ??
      asString(raw.modelCode) ??
      asString(snowplow?.ve_va),
    year: year != null ? Math.round(year) : null,
    mileage: mileage != null ? Math.round(mileage) : null,
    pricePence: price.pricePence,
    isPoa: price.isPoa,
    locationName:
      nestedString(raw, ["location", "name"]) ??
      asString(raw.location_name) ??
      asString(raw.locationName) ??
      asString(raw.location) ??
      "",
    vehicleType:
      asString(raw.type) ??
      asString(raw.bodystyle) ??
      asString(raw.bodyStyle) ??
      asString(raw.vehicleType) ??
      asString(snowplow?.ve_bs) ??
      asString(snowplow?.ve_ty),
    description:
      asString(raw.description) ??
      asString(raw.longDescription) ??
      asString(raw.attentionGrabber) ??
      asString(raw.attention_grabber) ??
      "",
    imageUrls: collectImages(raw, origin),
    fuel:
      nestedString(raw, ["fuel", "typeEnglish"]) ??
      nestedString(raw, ["fuel", "type"]) ??
      asString(raw.fuel) ??
      asString(snowplow?.ve_ft),
    transmission:
      nestedString(raw, ["transmission", "type"]) ??
      asString(raw.transmission) ??
      asString(snowplow?.ve_tr),
    bodyType: asString(raw.bodyStyle) ?? asString(raw.bodystyle) ?? asString(raw.bodyType),
    colour:
      nestedString(raw, ["colour", "exteriorGenericEnglish"]) ??
      nestedString(raw, ["colour", "exteriorGeneric"]) ??
      nestedString(raw, ["colour", "exterior"]) ??
      asString(raw.colour) ??
      asString(raw.exterior_colour),
    doors: asNumber(raw.doors) ?? nestedNumber(raw, ["body", "doors"]),
    seats: asNumber(raw.seats) ?? nestedNumber(raw, ["body", "seats"]),
    engineSize: mapEngineSize(
      nestedString(raw, ["engine", "description"]) ??
        asString(raw.engine_size) ??
        asNumber(raw.engineSize) ??
        nestedNumber(raw, ["engine", "capacity"]),
    ),
    enginePower:
      asNumber(raw.enginePower) ??
      nestedNumber(raw, ["engine", "power"]) ??
      nestedNumber(raw, ["engine", "bhp"]),
  };
}

export function vehicleIdentityToken(vehicle: {
  sourceVehicleId?: string | null;
  stockId?: string | null;
  registration?: string | null;
  stockReference?: string | null;
  detailUrl?: string | null;
  make: string;
  model: string;
  year?: number | null;
  mileage?: number | null;
  pricePence?: number | null;
}) {
  return (
    vehicle.sourceVehicleId ??
    vehicle.stockId ??
    vehicle.registration ??
    vehicle.stockReference ??
    vehicle.detailUrl ??
    `${vehicle.make}-${vehicle.model}-${vehicle.year}-${vehicle.mileage}-${vehicle.pricePence}`
  );
}
