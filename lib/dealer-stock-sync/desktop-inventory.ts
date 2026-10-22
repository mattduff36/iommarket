import { z } from "zod";
import { FEATURED_LISTING_PHOTO_LIMIT } from "@/lib/listings/photo-limits";
import { scrapeFailureReason, type SourceCompleteness } from "@/lib/dealer-stock-sync/completeness";
import {
  assertDesktopSourceUrl,
  desktopDetailUrlRules,
  desktopImageUrlRules,
  DesktopSourcePolicyError,
} from "@/lib/dealer-stock-sync/desktop-source-policy";
import { guardOceanScope, reconcileDealerVehicles } from "@/scripts/dealer-stock-sync/reconcile";
import { getDealer } from "@/scripts/dealer-stock-sync/registry";
import type {
  CanonicalVehicle,
  ConnectorKey,
  DealerRecord,
  DealerSourceConfig,
  PipelineResult,
  SourceListResult,
  SourceStatus,
} from "@/scripts/dealer-stock-sync/types";

const MAX_VEHICLES = 2000;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const CONNECTORS = [
  "netdirector",
  "click-dealer",
  "dragon2000",
  "autoweb",
  "dealer-websites",
  "iomwebdesign",
  "html-structured",
  "csv",
  "unknown",
] as const satisfies readonly ConnectorKey[];
const SOURCE_STATUSES = ["ok", "failed", "blocked_requires_feed", "no_public_stock", "skipped"] as const;
const AVAILABILITY = ["available", "reserved", "sold", "unknown"] as const;

export class DesktopSubmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesktopSubmissionError";
  }
}

const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/).refine((value) => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() ===
    (value.includes(".") ? value : value.replace("Z", ".000Z"));
});
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
});
const count = (max: number) => z.number().finite().int().nonnegative().max(max);
const nullableCount = (max: number) => count(max).nullable();
const label = (max: number) => z.string().min(1).max(max);
const optionalLabel = (max: number) => label(max).nullable();

const provenanceSchema = z.object({
  startUrl: z.string().max(2048).nullable(),
  sourceKeys: z.array(label(80)).max(4),
  rawIdentityHints: z.array(label(120)).max(10),
}).strict();

const vehicleSchema = z.object({
  dealerKey: label(80),
  sourceKey: label(80),
  platform: z.enum(CONNECTORS),
  sourceVehicleId: optionalLabel(80),
  registration: optionalLabel(16),
  vin: optionalLabel(17),
  stockReference: optionalLabel(40),
  make: label(80),
  model: label(80),
  derivative: optionalLabel(120),
  year: z.number().finite().int().min(1950).max(2100).nullable(),
  firstRegistrationDate: day.nullable(),
  mileage: nullableCount(2_000_000),
  pricePence: nullableCount(200_000_000),
  isPoa: z.boolean(),
  fuel: optionalLabel(40),
  transmission: optionalLabel(40),
  bodyType: optionalLabel(40),
  colour: optionalLabel(40),
  doors: nullableCount(8),
  seats: nullableCount(15),
  // Website connectors retain source units (litres or cc); NetDirector uses litres.
  engineSize: z.number().finite().nonnegative().max(20_000).nullable(),
  enginePower: nullableCount(2_000),
  vehicleType: optionalLabel(40),
  description: z.string().max(4_000),
  locationName: optionalLabel(120),
  detailUrl: z.string().max(2048).nullable(),
  imageUrls: z.array(z.string().min(1).max(2048)).max(FEATURED_LISTING_PHOTO_LIMIT),
  availability: z.enum(AVAILABILITY),
  sourceCreatedAt: instant.nullable(),
  sourceUpdatedAt: instant.nullable(),
  scrapedAt: instant,
  provenance: provenanceSchema,
}).strict();

const sourceSchema = z.object({
  dealerKey: label(80),
  sourceKey: label(80),
  platform: z.enum(CONNECTORS),
  status: z.enum(SOURCE_STATUSES),
  error: z.string().max(300).nullable(),
  startUrl: z.string().max(2048).nullable(),
  pagesFetched: count(100),
  advertisedCount: nullableCount(MAX_VEHICLES),
  rawCount: nullableCount(MAX_VEHICLES),
  vehicles: z.array(vehicleSchema).max(MAX_VEHICLES),
  detailMissing: count(MAX_VEHICLES).optional(),
  paginationUncertain: z.boolean().optional(),
}).strict();

const submissionSchema = z.object({
  sourceResults: z.array(sourceSchema).max(20),
  scrapeStartedAt: instant,
  scrapeFinishedAt: instant,
}).strict();

type ParsedSubmission = z.infer<typeof submissionSchema>;
type ParsedSource = z.infer<typeof sourceSchema>;
type ParsedVehicle = z.infer<typeof vehicleSchema>;

function reject(message: string): never {
  throw new DesktopSubmissionError(message);
}

function schemaMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue?.path.map(String).join(".") ?? "";
  const keys = issue && "keys" in issue && Array.isArray(issue.keys)
    ? issue.keys.filter((key): key is string => typeof key === "string").join(".")
    : "";
  const where = [path, keys].filter(Boolean).join(".") || "submission";
  return `Invalid desktop submission at ${where}.`;
}

function assertBounded(input: unknown) {
  if (typeof input === "string") {
    if (Buffer.byteLength(input, "utf8") > MAX_JSON_BYTES) reject("Submission exceeds 2MiB.");
    reject("Invalid desktop submission at submission.");
  }
  let encoded: string;
  try {
    encoded = JSON.stringify(input);
  } catch {
    reject("Submission is not bounded JSON.");
  }
  if (!encoded || Buffer.byteLength(encoded, "utf8") > MAX_JSON_BYTES) reject("Submission exceeds 2MiB.");
}

function assertWindow(startedAt: string, finishedAt: string) {
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  const latest = Date.now() + 48 * 60 * 60 * 1000;
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) {
    reject("Scrape timestamps are invalid.");
  }
  if (started < Date.parse("2020-01-01T00:00:00.000Z") || finished > latest) {
    reject("Scrape timestamps are invalid.");
  }
}

function sameKeys(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function assertSourceIdentity(source: ParsedSource, dealer: DealerRecord, configured: DealerSourceConfig) {
  if (source.dealerKey !== dealer.key || source.sourceKey !== configured.key) {
    reject("Source identity does not match the registry.");
  }
  if (source.platform !== configured.connectorKey || source.startUrl !== configured.startUrl) {
    reject("Source identity does not match the registry.");
  }
  if (source.status === "ok" && source.error !== null) reject("A complete source cannot include an error.");
  if (source.status !== "ok" && source.vehicles.length > 0) reject("A failed source cannot include vehicles.");
  if (source.rawCount != null && source.rawCount !== source.vehicles.length) {
    reject("Source rawCount does not match the vehicles.");
  }
  if (source.advertisedCount != null && source.advertisedCount < source.vehicles.length) {
    reject("Source advertisedCount is below the vehicles.");
  }
}

function rebuildVehicle(
  vehicle: ParsedVehicle,
  dealer: DealerRecord,
  configured: DealerSourceConfig,
  startedAt: string,
  finishedAt: string,
): CanonicalVehicle {
  if (vehicle.dealerKey !== dealer.key || vehicle.sourceKey !== configured.key || vehicle.platform !== configured.connectorKey) {
    reject("Vehicle identity does not match the registry.");
  }
  if (vehicle.provenance.startUrl !== configured.startUrl || !sameKeys(vehicle.provenance.sourceKeys, [configured.key])) {
    reject("Vehicle provenance does not match the registry.");
  }
  const scraped = Date.parse(vehicle.scrapedAt);
  if (scraped < Date.parse(startedAt) || scraped > Date.parse(finishedAt)) {
    reject("Vehicle scrapedAt is outside the scrape window.");
  }
  const detailRules = desktopDetailUrlRules(configured.startUrl);
  const imageRules = desktopImageUrlRules(dealer.key, configured.connectorKey, configured.startUrl);
  const detailUrl = vehicle.detailUrl == null ? null : assertDesktopSourceUrl(vehicle.detailUrl, detailRules);
  const imageUrls = vehicle.imageUrls.map((url) => assertDesktopSourceUrl(url, imageRules));
  if (new Set(imageUrls).size !== imageUrls.length) reject("Vehicle image URLs must be unique.");
  return {
    ...vehicle,
    detailUrl,
    imageUrls,
    provenance: {
      startUrl: configured.startUrl,
      sourceKeys: [configured.key],
      rawIdentityHints: [...vehicle.provenance.rawIdentityHints],
    },
  };
}

function normaliseCompleteness(source: ParsedSource, vehicles: CanonicalVehicle[]): SourceListResult {
  const detailMissing = source.detailMissing ?? 1;
  const paginationUncertain = source.paginationUncertain !== false;
  return {
    dealerKey: source.dealerKey,
    sourceKey: source.sourceKey,
    platform: source.platform,
    status: source.status as SourceStatus,
    error: source.error,
    startUrl: source.startUrl,
    pagesFetched: source.pagesFetched,
    advertisedCount: source.advertisedCount,
    rawCount: source.rawCount,
    vehicles,
    detailMissing,
    paginationUncertain,
  };
}

function toCompleteness(source: SourceListResult): SourceCompleteness {
  return {
    status: source.status,
    vehicleCount: source.vehicles.length,
    advertisedCount: source.advertisedCount,
    pagesFetched: source.pagesFetched,
    detailMissing: source.detailMissing ?? 1,
    paginationUncertain: source.paginationUncertain !== false,
  };
}

function cloneDealer(dealer: DealerRecord): DealerRecord {
  return {
    ...dealer,
    displayNameAliases: dealer.displayNameAliases ? [...dealer.displayNameAliases] : undefined,
    stockUrls: [...dealer.stockUrls],
    locations: [...dealer.locations],
    sources: dealer.sources.map((source) => ({ ...source })),
  };
}

function sourcesInRegistryOrder(parsed: ParsedSubmission, dealer: DealerRecord): SourceListResult[] {
  const byKey = new Map<string, ParsedSource>();
  for (const source of parsed.sourceResults) {
    if (byKey.has(source.sourceKey)) reject(`Duplicate source ${source.sourceKey}.`);
    byKey.set(source.sourceKey, source);
  }
  const expected = new Set(dealer.sources.map((source) => source.key));
  for (const key of byKey.keys()) {
    if (!expected.has(key)) reject(`Unexpected source ${key}.`);
  }
  for (const source of dealer.sources) {
    if (!byKey.has(source.key)) reject(`Missing source ${source.key}.`);
  }
  const rebuilt: SourceListResult[] = [];
  let total = 0;
  for (const configured of dealer.sources) {
    const source = byKey.get(configured.key);
    if (!source) reject(`Missing source ${configured.key}.`);
    assertSourceIdentity(source, dealer, configured);
    const vehicles = source.vehicles.map((vehicle) =>
      rebuildVehicle(vehicle, dealer, configured, parsed.scrapeStartedAt, parsed.scrapeFinishedAt),
    );
    total += vehicles.length;
    if (total > MAX_VEHICLES) reject("Submission exceeds 2000 vehicles.");
    rebuilt.push(normaliseCompleteness(source, vehicles));
  }
  return rebuilt;
}

function parseSubmission(registryKey: string, input: unknown): PipelineResult {
  assertBounded(input);
  const parsed = submissionSchema.safeParse(input);
  if (!parsed.success) reject(schemaMessage(parsed.error));
  assertWindow(parsed.data.scrapeStartedAt, parsed.data.scrapeFinishedAt);
  if (!/^[a-z0-9-]{1,80}$/.test(registryKey)) reject("Unknown dealer.");
  const dealer = getDealer(registryKey);
  const sourceResults = sourcesInRegistryOrder(parsed.data, dealer);
  const guarded = guardOceanScope(sourceResults);
  const failure = scrapeFailureReason(guarded.sourceResults.map(toCompleteness));
  return {
    dealer: cloneDealer(dealer),
    sourceResults: guarded.sourceResults,
    reconciled: reconcileDealerVehicles(sourceResults),
    canArchive: !guarded.blocked && failure === null,
    scrapeStartedAt: parsed.data.scrapeStartedAt,
    scrapeFinishedAt: parsed.data.scrapeFinishedAt,
  };
}

export function parseDesktopScrapeSubmission(registryKey: string, input: unknown): PipelineResult {
  try {
    return parseSubmission(registryKey, input);
  } catch (error) {
    if (error instanceof DesktopSourcePolicyError) throw new DesktopSubmissionError(error.message);
    throw error;
  }
}
