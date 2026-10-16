import { z } from "zod";
import {
  TRADE_FUELS,
  TRADE_REASON_CODES,
  TRADE_REPORT_REASONS,
  TRADE_TRANSMISSIONS,
} from "@/lib/trade-exchange/constants";

const currentYear = new Date().getFullYear();
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal("")).transform((value) => value || undefined);

function emptyToUndefined(value: unknown) {
  if (value == null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

const optionalInt = (min: number, max: number) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().min(min).max(max).optional());

const registrationIdentifier = z
  .string()
  .trim()
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ./-]*$/, "Enter the registration identifier as published. It does not have to be numbers only.")
  .or(z.literal(""))
  .transform((value) => value || undefined);

export const tradeApplicationSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  legalEntityName: optionalText(160),
  entityType: z.enum([
    "REGISTERED_COMPANY",
    "REGISTERED_BUSINESS_NAME",
    "SOLE_TRADER_OR_PARTNERSHIP",
    "OTHER",
  ]),
  registrationIdentifier,
  tradingAddress: z.string().trim().min(8).max(300),
  website: z.union([z.string().trim().url().max(200), z.literal("")]).transform((value) => value || undefined),
  contactName: z.string().trim().min(2).max(100),
  roleDeclaration: z.string().trim().min(2).max(120),
  workEmail: z.string().trim().email().max(200),
  phone: z.string().trim().min(6).max(30),
  activityDescription: z.string().trim().min(10).max(1000),
  authorityConfirmed: z.literal(true, { error: "Confirm you are authorised to act for this business." }),
});

export const tradeListingSchema = z
  .object({
    make: z.string().trim().min(1).max(40),
    model: z.string().trim().min(1).max(60),
    year: z.coerce.number().int().min(1950).max(currentYear + 1),
    mileage: z.coerce.number().int().min(0).max(2_000_000),
    transmission: z.enum(TRADE_TRANSMISSIONS),
    fuel: z.enum(TRADE_FUELS),
    conditionSummary: z.string().trim().min(2).max(80),
    disclosedDefects: z.string().trim().min(2).max(2000),
    serviceHistory: optionalText(2000),
    motStatus: optionalText(120),
    priceType: z.enum(["FIXED", "POA", "OFFERS_INVITED"]),
    pricePence: optionalInt(1, 100_000_000),
    vatTreatment: z.enum(["PLUS_VAT", "VAT_INCLUDED", "NO_VAT", "NOT_STATED"]),
    registrationNumber: optionalText(16),
    vin: z
      .union([
        z.literal(""),
        z.string().trim().toUpperCase().regex(/^[A-HJ-NPR-Z0-9]{11,17}$/, "Enter a valid VIN, or leave it blank."),
      ])
      .optional()
      .transform((value) => value || undefined),
    locationLabel: z.string().trim().min(2).max(80),
    notes: optionalText(2000),
    contactPreference: z.enum(["MESSAGE", "PHONE", "EITHER"]),
    availabilityNote: optionalText(200),
    ownershipDeclared: z.boolean(),
    authorityDeclared: z.boolean(),
    mileageDeclared: z.boolean(),
    conditionDeclared: z.boolean(),
    notWrittenOffDeclared: z.boolean(),
    writeOff: z.literal("NONE", { error: "Written-off vehicles cannot be advertised on Trade Exchange." }),
  })
  .superRefine((value, context) => {
    if (value.priceType === "FIXED" && !value.pricePence) {
      context.addIssue({ code: "custom", path: ["pricePence"], message: "Enter a fixed trade price." });
    }
    if (value.priceType !== "FIXED" && value.pricePence) {
      context.addIssue({ code: "custom", path: ["pricePence"], message: "Leave the price empty unless the price type is fixed." });
    }
  });

export type TradeListingInput = z.infer<typeof tradeListingSchema>;

export function listingIsPublishable(input: TradeListingInput, photoCount: number): string | null {
  if (photoCount < 1) return "Add at least one photo before publishing.";
  if (!input.ownershipDeclared || !input.authorityDeclared || !input.mileageDeclared || !input.conditionDeclared || !input.notWrittenOffDeclared) {
    return "Confirm ownership, authority, mileage, condition and that the vehicle is not a write-off.";
  }
  if (input.writeOff !== "NONE") return "Written-off vehicles cannot be advertised on Trade Exchange.";
  return null;
}

export const tradeSearchSchema = z.object({
  make: optionalText(40),
  model: optionalText(60),
  minPrice: optionalInt(0, 100_000_000),
  maxPrice: optionalInt(0, 100_000_000),
  minYear: optionalInt(1950, currentYear + 1),
  maxYear: optionalInt(1950, currentYear + 1),
  minMileage: optionalInt(0, 2_000_000),
  maxMileage: optionalInt(0, 2_000_000),
  transmission: z.enum(TRADE_TRANSMISSIONS).optional().or(z.literal("").transform(() => undefined)),
  fuel: z.enum(TRADE_FUELS).optional().or(z.literal("").transform(() => undefined)),
  dealerId: z.string().trim().min(1).max(40).optional().or(z.literal("").transform(() => undefined)),
  condition: optionalText(80),
  sort: z.enum(["newest"]).default("newest"),
});

export type TradeSearchInput = z.infer<typeof tradeSearchSchema>;

export const tradeEnquirySchema = z.object({
  listingId: z.string().trim().min(1).max(40),
  body: z.string().trim().min(1).max(2000),
  offerPence: optionalInt(1, 100_000_000),
});

export const tradeDecisionSchema = z.object({
  membershipId: z.string().trim().min(1).max(40),
  decision: z.enum(["APPROVED", "REJECTED", "NEEDS_INFO", "SUSPENDED", "REVOKED"]),
  reasonCode: z.enum(TRADE_REASON_CODES).optional(),
  note: optionalText(500),
}).superRefine((value, context) => {
  if (value.decision !== "APPROVED" && !value.reasonCode) {
    context.addIssue({ code: "custom", path: ["reasonCode"], message: "Choose a reason." });
  }
});

export const tradeReportSchema = z.object({
  listingId: z.string().trim().min(1).max(40),
  reasonCode: z.enum(TRADE_REPORT_REASONS),
  details: z.string().trim().min(2).max(1000),
});

export function normalizeRegistration(value: string | undefined): string | null {
  if (!value) return null;
  return value.toUpperCase().replace(/\s+/g, "");
}

export function detectImageType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  return null;
}

export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}
