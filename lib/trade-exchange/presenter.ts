import type { TradeContactPreference, TradeListingStatus, TradePriceType, TradeVatTreatment } from "@prisma/client";

export interface TradeListingRecord {
  id: string;
  dealerId: string;
  status: TradeListingStatus;
  make: string;
  model: string;
  year: number;
  mileage: number;
  transmission: string;
  fuel: string;
  conditionSummary: string;
  disclosedDefects: string;
  serviceHistory: string | null;
  motStatus: string | null;
  priceType: TradePriceType;
  pricePence: number | null;
  vatTreatment: TradeVatTreatment;
  registrationNumber: string | null;
  vin: string | null;
  locationLabel: string;
  notes: string | null;
  contactPreference: TradeContactPreference;
  availabilityNote: string | null;
  publishedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  dealer?: { name: string } | null;
  images: Array<{ id: string; width: number; height: number; sortOrder: number }>;
}

export interface TradeListingView {
  id: string;
  dealerId: string;
  dealerName: string;
  status: TradeListingStatus;
  make: string;
  model: string;
  year: number;
  mileage: number;
  transmission: string;
  fuel: string;
  conditionSummary: string;
  disclosedDefects: string;
  serviceHistory: string | null;
  motStatus: string | null;
  priceType: TradePriceType;
  pricePence: number | null;
  vatTreatment: TradeVatTreatment;
  registrationNumber: string | null;
  vin: string | null;
  locationLabel: string;
  notes: string | null;
  contactPreference: TradeContactPreference;
  availabilityNote: string | null;
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  images: Array<{ id: string; width: number; height: number }>;
  ownsListing: boolean;
}

export function presentTradeListing(
  listing: TradeListingRecord,
  viewer: { dealerId?: string; admin?: boolean },
  options?: { includeIdentity?: boolean },
): TradeListingView {
  const ownsListing = viewer.admin === true || viewer.dealerId === listing.dealerId;
  const revealIdentity = options?.includeIdentity === true && ownsListing;
  return {
    id: listing.id,
    dealerId: listing.dealerId,
    dealerName: listing.dealer?.name ?? "Dealer",
    status: listing.status,
    make: listing.make,
    model: listing.model,
    year: listing.year,
    mileage: listing.mileage,
    transmission: listing.transmission,
    fuel: listing.fuel,
    conditionSummary: listing.conditionSummary,
    disclosedDefects: listing.disclosedDefects,
    serviceHistory: listing.serviceHistory,
    motStatus: listing.motStatus,
    priceType: listing.priceType,
    pricePence: listing.priceType === "FIXED" ? listing.pricePence : null,
    vatTreatment: listing.vatTreatment,
    registrationNumber: revealIdentity ? listing.registrationNumber : null,
    vin: revealIdentity ? listing.vin : null,
    locationLabel: listing.locationLabel,
    notes: listing.notes,
    contactPreference: listing.contactPreference,
    availabilityNote: listing.availabilityNote,
    publishedAt: listing.publishedAt?.toISOString() ?? null,
    expiresAt: listing.expiresAt?.toISOString() ?? null,
    createdAt: listing.createdAt.toISOString(),
    images: [...listing.images]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((image) => ({ id: image.id, width: image.width, height: image.height })),
    ownsListing,
  };
}

export function formatTradePrice(listing: Pick<TradeListingView, "priceType" | "pricePence">): string {
  if (listing.priceType === "POA") return "POA";
  if (listing.priceType === "OFFERS_INVITED") return "Offers invited";
  if (listing.pricePence == null) return "POA";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(listing.pricePence / 100);
}
