import type { IomVehicleData } from "./iom-vehicle-api";
import type { DVLAVehicleData } from "./dvla-api";
import type { VehicleMotHistory } from "./vehicle-check-types";
import { normalizeMakeLookupKey } from "@/lib/vehicle-catalogue/make-canonicalization";

type IomIdentity = Pick<IomVehicleData, "make" | "model" | "modelVariant" | "previousUkRegistration" | "dateOfFirstRegistration" | "engineSizeCc" | "fuelType">;
type UkIdentity = Pick<DVLAVehicleData, "registrationNumber" | "make" | "model" | "yearOfManufacture" | "engineSizeCc" | "fuelType">;
type MotIdentity = Pick<VehicleMotHistory, "registrationNumber" | "make" | "model" | "firstUsedDate" | "fuelType">;

const clean = (value: string | null | undefined) => value?.trim().replace(/\s+/g, " ") || null;
const key = (value: string | null | undefined) => clean(value)?.replace(/[^a-z0-9]/gi, "").toUpperCase() || "";
const year = (value: string | null) => {
  const match = value?.match(/\b((?:19|20)\d{2})\b/);
  return match ? Number(match[1]) : null;
};
const fuel = (value: string | null) => {
  const normalized = key(value);
  return normalized === "GASOLINE" ? "PETROL" : normalized === "HEAVYOIL" ? "DIESEL" : normalized;
};

export function separateModelVariant(model: string | null, rawVariant: string | null) {
  let variant = clean(rawVariant);
  const base = clean(model);
  if (!variant || !base) return variant;
  if (key(base) === key(variant)) return null;
  if (variant.toLowerCase().startsWith(`${base.toLowerCase()} `)) {
    variant = clean(variant.slice(base.length));
  }
  return variant;
}

export function resolveIomModelIdentity(iom: IomIdentity, uk: UkIdentity | null, mot: MotIdentity | null) {
  const linkedRegistration = key(iom.previousUkRegistration);
  const iomMake = iom.make ? normalizeMakeLookupKey(iom.make) : "";
  const iomYear = year(iom.dateOfFirstRegistration);
  const contradicts = (candidate: UkIdentity | MotIdentity) => {
    if (key(candidate.registrationNumber) && key(candidate.registrationNumber) !== linkedRegistration) return true;
    if (iomMake && candidate.make && normalizeMakeLookupKey(candidate.make) !== iomMake) return true;
    const candidateYear = "yearOfManufacture" in candidate ? candidate.yearOfManufacture : year(candidate.firstUsedDate);
    if (iomYear && candidateYear && Math.abs(iomYear - candidateYear) > 1) return true;
    if (fuel(iom.fuelType) && fuel(candidate.fuelType) && fuel(iom.fuelType) !== fuel(candidate.fuelType)) return true;
    if ("engineSizeCc" in candidate && iom.engineSizeCc && candidate.engineSizeCc && Math.abs(iom.engineSizeCc - candidate.engineSizeCc) > 50) return true;
    return false;
  };
  const compatible = (candidate: UkIdentity | MotIdentity) => Boolean(linkedRegistration && key(candidate.registrationNumber) === linkedRegistration && iomMake && candidate.make && normalizeMakeLookupKey(candidate.make) === iomMake && !contradicts(candidate));
  const candidates = [mot, uk].filter((candidate): candidate is UkIdentity | MotIdentity => Boolean(candidate));
  const models = candidates.filter(compatible).map((candidate) => clean(candidate.model)?.toLowerCase()).filter((model): model is string => Boolean(model));
  const modelsDisagree = models.length === 2 && models[0] !== models[1] && !models[0].startsWith(`${models[1]} `) && !models[1].startsWith(`${models[0]} `);
  const rawIomModel = clean(iom.model);
  // Some source records repeat their trim in both fields; this is not a base model.
  const iomModel = rawIomModel && key(rawIomModel) !== key(iom.modelVariant) ? rawIomModel : null;
  const proposed = clean(candidates.find((candidate) => compatible(candidate) && clean(candidate.model))?.model);
  const iomModelConflict = Boolean(iomModel && proposed && key(iomModel) !== key(proposed) && !iomModel.toLowerCase().startsWith(`${proposed.toLowerCase()} `) && !proposed.toLowerCase().startsWith(`${iomModel.toLowerCase()} `));
  const conflict = Boolean(linkedRegistration && (candidates.some(contradicts) || modelsDisagree || iomModelConflict));
  const linkedModel = !conflict ? proposed : null;
  const model = linkedModel ?? iomModel;
  return {
    model,
    variant: separateModelVariant(model, iom.modelVariant),
    source: linkedModel ? "previous-uk" as const : iomModel ? "iom" as const : "unresolved" as const,
    warning: conflict ? "The linked UK vehicle details do not agree with the Manx record. Confirm the model manually; current Manx details have been retained." : null,
  };
}
