import type { CatalogueIdentityLookup } from "../../lib/vehicle-catalogue/identity";
import { normalizeVehicleIdentity } from "../../lib/vehicle-catalogue/identity";
import { normalizeMakeLookupKey } from "../../lib/vehicle-catalogue/make-canonicalization";
import { normalizeCatalogueName } from "../../lib/vehicle-catalogue/normalize";
import type { EnrichReasonCode } from "./enrich-types";

export function makesAgree(listingMake: string, lookupMake: string) {
  const left = normalizeMakeLookupKey(listingMake);
  const right = normalizeMakeLookupKey(lookupMake);
  return Boolean(left) && left === right;
}

export function yearsAgree(listingYear: string, lookupYear: number | null) {
  if (!listingYear.trim()) return false;
  if (lookupYear == null || !Number.isFinite(lookupYear)) return false;
  return String(lookupYear) === listingYear.trim();
}

export async function modelsAgree(input: {
  listingModel: string;
  lookupModel: string;
  listingMake: string;
  lookupMake: string;
  catalogueLookup?: CatalogueIdentityLookup;
}) {
  if (input.catalogueLookup) {
    const [listingIdentity, lookupIdentity] = await Promise.all([
      normalizeVehicleIdentity(input.listingMake, input.listingModel, input.catalogueLookup),
      normalizeVehicleIdentity(input.lookupMake, input.lookupModel, input.catalogueLookup),
    ]);
    if (listingIdentity.modelMatched && lookupIdentity.modelMatched) {
      return listingIdentity.model === lookupIdentity.model;
    }
  }
  const left = normalizeCatalogueName(input.listingModel);
  const right = normalizeCatalogueName(input.lookupModel);
  return Boolean(left) && left === right;
}

export async function evaluateLookupIdentity(input: {
  listingMake: string;
  listingModel: string;
  listingYear: string;
  lookupMake: string | null;
  lookupModel: string | null;
  lookupYear: number | null;
  catalogueLookup?: CatalogueIdentityLookup;
}): Promise<{ ok: true } | { ok: false; reason: EnrichReasonCode }> {
  if (!input.listingMake.trim() || !input.lookupMake?.trim()) {
    return { ok: false, reason: "skip-make-mismatch" };
  }
  if (!makesAgree(input.listingMake, input.lookupMake)) {
    return { ok: false, reason: "skip-make-mismatch" };
  }
  if (!input.listingModel.trim() || !input.lookupModel?.trim()) {
    return { ok: false, reason: "skip-model-mismatch" };
  }
  const modelOk = await modelsAgree({
    listingModel: input.listingModel,
    lookupModel: input.lookupModel,
    listingMake: input.listingMake,
    lookupMake: input.lookupMake,
    catalogueLookup: input.catalogueLookup,
  });
  if (!modelOk) return { ok: false, reason: "skip-model-mismatch" };
  if (!yearsAgree(input.listingYear, input.lookupYear)) {
    return { ok: false, reason: "skip-year-mismatch" };
  }
  return { ok: true };
}
