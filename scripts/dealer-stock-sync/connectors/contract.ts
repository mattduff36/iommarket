import type {
  CanonicalVehicle,
  ConnectorKey,
  DealerRecord,
  DealerSourceConfig,
  ProbeResult,
  SourceListResult,
} from "../types";

export interface ConnectorContext {
  dealer: DealerRecord;
  source: DealerSourceConfig;
  fetchImpl?: typeof fetch;
  delayMs?: number;
}

export interface ConnectorDetectInput {
  url?: string | null;
  html?: string;
  requestUrls?: string[];
  requestBodies?: Array<string | null>;
}

export interface StockConnector {
  key: ConnectorKey;
  detect(input: ConnectorDetectInput): boolean;
  discoverSources?(dealer: DealerRecord): DealerSourceConfig[];
  probe(context: ConnectorContext): Promise<ProbeResult>;
  fetchList(context: ConnectorContext): Promise<SourceListResult>;
  fetchDetails(
    context: ConnectorContext,
    frozen: CanonicalVehicle[],
  ): Promise<{ vehicles: CanonicalVehicle[]; detailMissing: number }>;
  normalize(raw: unknown, context: ConnectorContext): CanonicalVehicle | null;
  validate(vehicle: CanonicalVehicle): string[];
}

export function emptyVehicle(
  context: ConnectorContext,
  overrides: Partial<CanonicalVehicle> = {},
): CanonicalVehicle {
  return {
    dealerKey: context.dealer.key,
    sourceKey: context.source.key,
    platform: context.source.connectorKey,
    sourceVehicleId: null,
    registration: null,
    vin: null,
    stockReference: null,
    make: "",
    model: "",
    derivative: null,
    year: null,
    firstRegistrationDate: null,
    mileage: null,
    pricePence: null,
    isPoa: false,
    fuel: null,
    transmission: null,
    bodyType: null,
    colour: null,
    doors: null,
    seats: null,
    engineSize: null,
    enginePower: null,
    vehicleType: null,
    description: "",
    locationName: null,
    detailUrl: null,
    imageUrls: [],
    availability: "unknown",
    sourceCreatedAt: null,
    sourceUpdatedAt: null,
    scrapedAt: new Date().toISOString(),
    provenance: {
      startUrl: context.source.startUrl,
      sourceKeys: [context.source.key],
      rawIdentityHints: [],
    },
    ...overrides,
  };
}

export function validateCanonicalVehicle(vehicle: CanonicalVehicle) {
  const errors: string[] = [];
  if (!vehicle.dealerKey) errors.push("missing dealerKey");
  if (!vehicle.sourceKey) errors.push("missing sourceKey");
  if (!vehicle.make && !vehicle.model) errors.push("missing make and model");
  return errors;
}
