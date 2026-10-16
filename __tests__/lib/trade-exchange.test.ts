import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";
import { hasTradeProEntitlement } from "@/lib/trade-exchange/entitlement";
import { canApplyForTrade, canEditTradeListing, canReadTradeEnquiry, canViewTradeListing, classifyTradeActor, tradeApplyDestination } from "@/lib/trade-exchange/decision";
import { canTransitionTradeEnquiry, canTransitionTradeListing } from "@/lib/trade-exchange/lifecycle";
import { isTradeExchangeEnabled } from "@/lib/trade-exchange/flag";
import { parseTradeImport } from "@/lib/trade-exchange/import-csv";
import { listingMatchesSavedSearch } from "@/lib/trade-exchange/search";
import { detectImageType, isPdf, listingIsPublishable, tradeListingSchema } from "@/lib/trade-exchange/validation";
import { presentTradeListing } from "@/lib/trade-exchange/presenter";
import { buildTradeEnquiryEmail, buildTradeSavedSearchEmail, tradeEmailContains } from "@/lib/trade-exchange/emails";
import { isAnalyticsPathAllowed } from "@/lib/analytics/privacy";
import { isTradeExchangePage } from "@/proxy";
import type { TradeListingStatus } from "@prisma/client";

const now = new Date("2026-10-14T12:00:00.000Z");
const future = new Date("2026-11-14T12:00:00.000Z");
const past = new Date("2026-09-14T12:00:00.000Z");

function paid(planId: string, end = future) {
  return {
    source: "PAYMENT" as const,
    status: "ACTIVE" as const,
    currentPeriodEnd: end,
    grantStartsAt: null,
    grantEndsAt: null,
    revokedAt: null,
    providerPlanId: planId,
  };
}

const dealer = {
  id: "user-1",
  role: "DEALER" as const,
  disabledAt: null,
  deletedAt: null,
  dealerProfile: { id: "dealer-1", name: "Harbour Motors", tier: "PRO" as const },
};

describe("trade entitlement", () => {
  it("requires an active Pro payment or a Pro admin grant", () => {
    expect(hasTradeProEntitlement({ tier: "PRO", subscriptions: [paid(RIPPLE_CANONICAL_PRODUCTS.pro.code)], now })).toBe(true);
    expect(hasTradeProEntitlement({ tier: "STARTER", subscriptions: [paid(RIPPLE_CANONICAL_PRODUCTS.pro.code)], now })).toBe(true);
    expect(hasTradeProEntitlement({ tier: "PRO", subscriptions: [paid(RIPPLE_CANONICAL_PRODUCTS.starter.code)], now })).toBe(false);
    expect(hasTradeProEntitlement({ tier: "PRO", subscriptions: [paid(RIPPLE_CANONICAL_PRODUCTS.pro.code, past)], now })).toBe(false);
    expect(hasTradeProEntitlement({
      tier: "PRO",
      now,
      subscriptions: [{
        source: "ADMIN_GRANT",
        status: "ACTIVE",
        currentPeriodEnd: null,
        grantStartsAt: past,
        grantEndsAt: future,
        revokedAt: null,
        providerPlanId: null,
      }],
    })).toBe(true);
    expect(hasTradeProEntitlement({
      tier: "STARTER",
      now,
      subscriptions: [{
        source: "ADMIN_GRANT",
        status: "ACTIVE",
        currentPeriodEnd: null,
        grantStartsAt: past,
        grantEndsAt: future,
        revokedAt: null,
        providerPlanId: null,
      }],
    })).toBe(false);
  });
});

describe("trade access", () => {
  it("fails closed unless the feature, Pro entitlement and approval all exist", () => {
    expect(isTradeExchangeEnabled({})).toBe(false);
    expect(classifyTradeActor({ enabled: false, user: dealer, membershipStatus: "APPROVED", proEntitled: true }).kind).toBe("disabled");
    expect(classifyTradeActor({ enabled: true, user: null, membershipStatus: "NOT_APPLIED", proEntitled: false }).kind).toBe("anonymous");
    expect(classifyTradeActor({ enabled: true, user: { ...dealer, role: "USER", dealerProfile: null }, membershipStatus: "NOT_APPLIED", proEntitled: false }).kind).toBe("denied");
    expect(classifyTradeActor({ enabled: true, user: { ...dealer, disabledAt: now }, membershipStatus: "APPROVED", proEntitled: true }).kind).toBe("denied");
    const starter = classifyTradeActor({
      enabled: true,
      user: { ...dealer, dealerProfile: { ...dealer.dealerProfile, tier: "STARTER" } },
      membershipStatus: "NOT_APPLIED",
      proEntitled: false,
    });
    expect(starter.kind).toBe("applicant");
    expect(canApplyForTrade(starter)).toBe(true);
    const pending = classifyTradeActor({ enabled: true, user: dealer, membershipStatus: "PENDING", proEntitled: true });
    expect(pending.kind).toBe("applicant");
    expect(canApplyForTrade(pending)).toBe(false);
    expect(tradeApplyDestination(pending)).toBe("status");
    expect(tradeApplyDestination(starter)).toBe("form");
    expect(tradeApplyDestination({ kind: "anonymous" })).toBe("hidden");
    const suspended = classifyTradeActor({ enabled: true, user: dealer, membershipStatus: "SUSPENDED", proEntitled: true });
    expect(canApplyForTrade(suspended)).toBe(false);
    const approvedWithoutPro = classifyTradeActor({ enabled: true, user: dealer, membershipStatus: "APPROVED", proEntitled: false });
    expect(approvedWithoutPro.kind).toBe("applicant");
    expect(classifyTradeActor({ enabled: true, user: dealer, membershipStatus: "APPROVED", proEntitled: true }).kind).toBe("member");
    expect(classifyTradeActor({ enabled: true, user: { ...dealer, role: "ADMIN" }, membershipStatus: "NOT_APPLIED", proEntitled: false }).kind).toBe("admin");
  });

  it("hides another dealer's draft and identity, and blocks IDOR edits", () => {
    const member = { kind: "member" as const, userId: "user-1", dealerId: "dealer-1", dealerName: "Harbour Motors" };
    const other = { ...member, dealerId: "dealer-2" };
    expect(canViewTradeListing({ actor: other, listingDealerId: "dealer-1", status: "DRAFT", sellerEligible: true })).toBe(false);
    expect(canViewTradeListing({ actor: other, listingDealerId: "dealer-1", status: "LIVE", sellerEligible: false })).toBe(false);
    expect(canViewTradeListing({ actor: other, listingDealerId: "dealer-1", status: "LIVE", sellerEligible: true, expiresAt: future })).toBe(true);
    expect(canEditTradeListing(other, "dealer-1")).toBe(false);
    expect(canEditTradeListing(member, "dealer-1")).toBe(true);
    expect(canReadTradeEnquiry({ actor: other, fromDealerId: "dealer-3", toDealerId: "dealer-1" })).toBe(false);
    expect(canReadTradeEnquiry({ actor: member, fromDealerId: "dealer-2", toDealerId: "dealer-1" })).toBe(true);
    const view = presentTradeListing({
      id: "listing-1",
      dealerId: "dealer-1",
      status: "LIVE",
      make: "Volkswagen",
      model: "Golf",
      year: 2018,
      mileage: 42000,
      transmission: "Manual",
      fuel: "Petrol",
      conditionSummary: "Clean",
      disclosedDefects: "None known",
      serviceHistory: null,
      motStatus: null,
      priceType: "FIXED",
      pricePence: 1250000,
      vatTreatment: "NO_VAT",
      registrationNumber: "HMN123A",
      vin: "WVWZZZ1KZAW000001",
      locationLabel: "Douglas",
      notes: null,
      contactPreference: "MESSAGE",
      availabilityNote: null,
      publishedAt: now,
      expiresAt: future,
      createdAt: now,
      dealer: { name: "Harbour Motors" },
      images: [],
    }, { dealerId: "dealer-2" });
    expect(view.registrationNumber).toBeNull();
    expect(view.vin).toBeNull();
    expect(presentTradeListing({
      id: "listing-1",
      dealerId: "dealer-1",
      status: "LIVE",
      make: "Volkswagen",
      model: "Golf",
      year: 2018,
      mileage: 42000,
      transmission: "Manual",
      fuel: "Petrol",
      conditionSummary: "Clean",
      disclosedDefects: "None known",
      serviceHistory: null,
      motStatus: null,
      priceType: "FIXED",
      pricePence: 1250000,
      vatTreatment: "NO_VAT",
      registrationNumber: "HMN123A",
      vin: "WVWZZZ1KZAW000001",
      locationLabel: "Douglas",
      notes: null,
      contactPreference: "MESSAGE",
      availabilityNote: null,
      publishedAt: now,
      expiresAt: future,
      createdAt: now,
      dealer: { name: "Harbour Motors" },
      images: [],
    }, { dealerId: "dealer-1" }, { includeIdentity: true }).vin).toBe("WVWZZZ1KZAW000001");
    expect(view.dealerName).toBe("Harbour Motors");
  });
});

describe("trade listing rules", () => {
  it("rejects write-offs, price mismatches and publishing without a photo", () => {
    const base = {
      make: "Ford",
      model: "Focus",
      year: 2019,
      mileage: 30000,
      transmission: "Manual",
      fuel: "Petrol",
      conditionSummary: "Good",
      disclosedDefects: "None known",
      priceType: "FIXED",
      pricePence: 500000,
      vatTreatment: "NO_VAT",
      locationLabel: "Douglas",
      contactPreference: "MESSAGE",
      ownershipDeclared: true,
      authorityDeclared: true,
      mileageDeclared: true,
      conditionDeclared: true,
      notWrittenOffDeclared: true,
      writeOff: "NONE",
    };
    const parsed = tradeListingSchema.parse(base);
    expect(listingIsPublishable(parsed, 0)).toMatch(/photo/);
    expect(listingIsPublishable(parsed, 1)).toBeNull();
    expect(tradeListingSchema.safeParse({ ...base, writeOff: "CATEGORY_S" }).success).toBe(false);
    expect(tradeListingSchema.safeParse({ ...base, priceType: "POA", pricePence: 100 }).success).toBe(false);
    expect(canTransitionTradeListing("DRAFT", "LIVE", "owner")).toBe(true);
    expect(canTransitionTradeListing("LIVE", "PENDING_REVIEW", "owner")).toBe(false);
    expect(canTransitionTradeListing("LIVE", "EXPIRED", "system")).toBe(true);
    expect(canTransitionTradeListing("DRAFT", "EXPIRED", "system")).toBe(false);
    expect(canTransitionTradeEnquiry("OPEN", "ACCEPTED_IN_PRINCIPLE", "listing-owner")).toBe(true);
    expect(canTransitionTradeEnquiry("OPEN", "ACCEPTED_IN_PRINCIPLE", "enquirer")).toBe(false);
  });

  it("imports valid draft rows and rejects a bad header", () => {
    const csv = [
      "make,model,year,mileage,transmission,fuel,condition,defects,priceType,priceGbp,vat,location,notes",
      "Ford,Focus,2019,30000,Manual,Petrol,Good,None known,POA,,NO_VAT,Douglas,",
    ].join("\n");
    const parsed = parseTradeImport(csv);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.input.priceType).toBe("POA");
    expect(parsed.rows[0]?.input.ownershipDeclared).toBe(false);
    expect(parseTradeImport("make,model\nFord,Focus").errors[0]?.message).toMatch(/columns/i);
  });

  it("matches saved searches without treating POA as a priced result", () => {
    const listing = {
      make: "Ford",
      model: "Focus",
      year: 2019,
      mileage: 30000,
      transmission: "Manual",
      fuel: "Petrol",
      conditionSummary: "Good",
      priceType: "POA" as const,
      pricePence: null,
      dealerId: "dealer-1",
      publishedAt: now,
    };
    expect(listingMatchesSavedSearch(listing, { make: "ford", sort: "newest" })).toBe(true);
    expect(listingMatchesSavedSearch(listing, { maxPrice: 1000000, sort: "newest" })).toBe(false);
  });
});

describe("trade privacy", () => {
  it("keeps vehicle facts out of notification email and public analytics", () => {
    const email = buildTradeEnquiryEmail();
    expect(tradeEmailContains(email, "HMN123A")).toBe(false);
    expect(tradeEmailContains(email, "WVWZZZ")).toBe(false);
    expect(tradeEmailContains(email, "Golf")).toBe(false);
    expect(buildTradeSavedSearchEmail(2).text).toContain("2 new trade listings");
    expect(buildTradeSavedSearchEmail(2).text).not.toContain("£");
    expect(isAnalyticsPathAllowed("/dealer/trade/listings/listing-1")).toBe(false);
    expect(isTradeExchangePage("/dealer/trade/listings/listing-1")).toBe(true);
    for (const status of ["DRAFT", "LIVE"] as TradeListingStatus[]) {
      expect(detectImageType(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
      expect(isPdf(Uint8Array.from(Buffer.from("%PDF-")))).toBe(true);
      expect(status).toBeTruthy();
    }
  });

  it("does not query trade inventory from public catalogue surfaces", () => {
    const files = [
      "app/catalogue/sitemap.ts",
      "lib/listings/marketplace.ts",
      "app/(public)/dealers/[slug]/page.tsx",
      "lib/search/attribute-sort.ts",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("tradeListing");
      expect(source).not.toContain("TradeListing");
    }
  });
});
