import { createHash } from "node:crypto";

export interface PreserveFingerprint {
  waitlist: string;
  content: string;
  settings: string;
  regions: string;
  categories: string;
  attributes: string;
  vehicleMakes: string;
  vehicleModels: string;
  vehicleAliases: string;
}

function cell(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (typeof value === "bigint") return `bigint:${value.toString()}`;
  if (typeof value === "boolean") return `boolean:${value}`;
  if (typeof value === "number") return `number:${value}`;
  if (typeof value === "string") return `string:${value}`;
  if (typeof value === "object") return `json:${JSON.stringify(value)}`;
  return `other:${String(value)}`;
}

function hashRows(rows: Array<Record<string, unknown>>) {
  const normalized = [...rows]
    .map((row) =>
      Object.keys(row)
        .sort()
        .map((key) => `${key}=${cell(row[key])}`)
        .join("|"),
    )
    .sort()
    .join("\n");
  return createHash("sha256").update(normalized).digest("hex");
}

export function fingerprintPreserveRows(input: {
  waitlist: Array<Record<string, unknown>>;
  content: Array<Record<string, unknown>>;
  settings: Array<Record<string, unknown>>;
  regions: Array<Record<string, unknown>>;
  categories: Array<Record<string, unknown>>;
  attributes: Array<Record<string, unknown>>;
  vehicleMakes: Array<Record<string, unknown>>;
  vehicleModels: Array<Record<string, unknown>>;
  vehicleAliases: Array<Record<string, unknown>>;
}): PreserveFingerprint {
  return {
    waitlist: hashRows(input.waitlist),
    content: hashRows(input.content),
    settings: hashRows(input.settings),
    regions: hashRows(input.regions),
    categories: hashRows(input.categories),
    attributes: hashRows(input.attributes),
    vehicleMakes: hashRows(input.vehicleMakes),
    vehicleModels: hashRows(input.vehicleModels),
    vehicleAliases: hashRows(input.vehicleAliases),
  };
}

export interface PreserveQueryClient {
  waitlistUser: { findMany: (args?: object) => Promise<Array<Record<string, unknown>>> };
  contentPage: { findMany: (args?: object) => Promise<Array<Record<string, unknown>>> };
  siteSetting: { findMany: (args?: object) => Promise<Array<Record<string, unknown>>> };
  region: { findMany: (args?: object) => Promise<Array<Record<string, unknown>>> };
  category: { findMany: (args?: object) => Promise<Array<Record<string, unknown>>> };
  attributeDefinition: { findMany: (args?: object) => Promise<Array<Record<string, unknown>>> };
  vehicleMake: { findMany: (args?: object) => Promise<Array<Record<string, unknown>>> };
  vehicleModel: { findMany: (args?: object) => Promise<Array<Record<string, unknown>>> };
  vehicleModelAlias: { findMany: (args?: object) => Promise<Array<Record<string, unknown>>> };
}

export async function loadPreserveFingerprint(db: PreserveQueryClient) {
  const [
    waitlist,
    content,
    settings,
    regions,
    categories,
    attributes,
    vehicleMakes,
    vehicleModels,
    vehicleAliases,
  ] = await Promise.all([
    db.waitlistUser.findMany(),
    db.contentPage.findMany(),
    db.siteSetting.findMany(),
    db.region.findMany(),
    db.category.findMany(),
    db.attributeDefinition.findMany(),
    db.vehicleMake.findMany(),
    db.vehicleModel.findMany(),
    db.vehicleModelAlias.findMany(),
  ]);
  return fingerprintPreserveRows({
    waitlist,
    content,
    settings,
    regions,
    categories,
    attributes,
    vehicleMakes,
    vehicleModels,
    vehicleAliases,
  });
}

export function assertFingerprintsMatch(
  before: PreserveFingerprint,
  after: PreserveFingerprint,
) {
  for (const key of Object.keys(before) as Array<keyof PreserveFingerprint>) {
    if (before[key] !== after[key]) {
      throw new Error(`Preserved ${key} fingerprint changed.`);
    }
  }
}
