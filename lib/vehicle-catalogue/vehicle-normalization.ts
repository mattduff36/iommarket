import { canonicalizeKnownMake, normalizeMakeLookupKey } from "./make-canonicalization";
import { cleanCatalogueName, normalizeCatalogueName } from "./normalize";

export interface VehicleMakeModel {
  make: string | null;
  model: string | null;
}

const MODEL_WORDS = new Map(
  [
    "AMG", "GT", "GTI", "GTD", "GTE", "GTS", "GTX", "GT3", "GT4", "RS", "ST",
    "SE", "SEL", "SL", "SLE", "SLK", "SLR", "SLX", "SR", "SRi", "SX", "SXI",
    "EX", "LX", "LS", "ES", "HSE", "VXR", "WRX", "STI", "TDI", "TSI", "TFSI",
    "FSI", "CDI", "HDI", "SDI", "DCI", "DTI", "VTEC", "VVT", "DSG", "DCT",
    "CVT", "EV", "PHEV", "HEV", "SUV", "MPV", "SWB", "MWB", "LWB", "XL",
    "CR", "HR", "FR", "CRV", "MT", "CX", "MX", "RX", "XF", "XE", "XJ",
    "TT", "GLA", "GLB", "GLC", "GLE", "GLS", "CLA", "CLS", "SLC", "XK",
    "ASX", "ZS", "IS", "NX", "NC", "VTR", "SRT", "GR", "SC", "AWD", "FWD", "RWD",
    "LHD", "RHD", "GDI", "MHEV", "SEC", "WAV", "RE", "ED", "ABS",
    "EcoSport", "EcoBoost", "EcoBlue", "XCeed", "BlueMotion", "BlueHDi", "HDi",
    "TDCi", "TGDi", "dCi", "CRDi", "TCe", "xDrive", "sDrive", "4Matic", "ALL4",
  ].map((word) => [word.toLowerCase(), word]),
);

function readableModel(value: string): string {
  return value.replace(/[A-Za-z0-9]+/g, (word) => {
    const known = MODEL_WORDS.get(word.toLowerCase());
    if (known) return known;
    if (word.length === 1) return word.toUpperCase();
    if (/^\d+dr$/i.test(word)) return word.toLowerCase();
    if (/^\d+x\d+$/i.test(word)) return word.toLowerCase();
    if (/^[a-z]{1,3}\d+[a-z\d]*$/i.test(word)) return word.toUpperCase();
    if (/\d/.test(word)) return word;
    return word[0].toUpperCase() + word.slice(1).toLowerCase();
  }).replace(/\bI-(VTEC|MMD|Shift)\b/g, "i-$1")
    .replace(/\bVVT-I\b/g, "VVT-i")
    .replace(/\b(\d)-Door\b/g, "$1-door");
}

function formatScopedModel(makeKey: string, value: string): string {
  switch (makeKey) {
    case "mercedesbenz":
      return value.replace(/^([ABCEGMRSVX])[\s-]*class\b/i, (_, code: string) => `${code.toUpperCase()}-Class`)
        .replace(/\b((?:[CG]L[ABCES]?|[ABCEGMSV])\d{2,3})([DE])\b/g, (_, code: string, suffix: string) => `${code}${suffix.toLowerCase()}`);
    case "bmw":
      return value.replace(/\b(\d{3})([DIE])\b/g, (_, code: string, suffix: string) => `${code}${suffix.toLowerCase()}`);
    case "jaguar":
      return value.replace(/^([FEI])[\s-]*pace\b/i, (_, code: string) => `${code.toUpperCase()}-Pace`)
        .replace(/^([FXS])[\s-]*type\b/i, (_, code: string) => `${code.toUpperCase()}-Type`);
    case "honda":
      return value.replace(/^(CR|HR|FR)[\s-]*V\b/i, (_, code: string) => `${code.toUpperCase()}-V`);
    case "yamaha":
      return value.replace(/^MT[\s-]*(03|07|09|10)\b/i, (_, code: string) => `MT-${code}`);
    case "hyundai":
      return value.replace(/^i(x?)(10|20|30|35|40)\b/i, (_, x: string, code: string) => `i${x.toLowerCase()}${code}`);
    case "kia":
      return value.replace(/^X[\s-]*Ceed\b/i, "XCeed");
    case "toyota":
      return value.replace(/^Hi[\s-]*Lux\b/i, "Hilux");
    case "peugeot":
      return value.replace(/^Ion\b/i, "iOn");
    case "fiat":
      return value.replace(/^Auto[\s-]*Trail\b/i, "Auto-Trail")
        .replace(/^500([lxc])\b/i, (_, suffix: string) => `500${suffix.toUpperCase()}`);
    case "volkswagen":
      return value.replace(/^T[\s-]*(roc|cross)\b/i, (_, word: string) =>
        `T-${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`);
    case "mazda":
      return value.replace(/^(CX|MX|RX)[\s-]*(\d{1,2})\b/i, (_, code: string, number: string) =>
        `${code.toUpperCase()}-${number}`);
    default:
      return value;
  }
}

export function normalizeVehicleModel(
  make: string | null | undefined,
  model: string | null | undefined,
): string | null {
  const cleaned = cleanCatalogueName((model ?? "")
    .replace(/&#(?:x2b|43);/gi, "+")
    .replace(/&#(?:x27|39);|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&"));
  if (!cleaned) return null;
  const makeKey = normalizeMakeLookupKey(make ?? "");
  const readable = readableModel(cleaned);
  const scoped = formatScopedModel(makeKey, readable);
  if (makeKey !== "landrover") return scoped;

  const discovery = scoped.replace(/^Range Rover\s+(?=Discovery\b)/i, "")
    .replace(/\bP(\d{3})E\b/g, (code, digits: string) =>
      /^(Range Rover|Defender|Discovery)\b/i.test(scoped) ? `P${digits}e` : code);
  if (/^Discovery\b/i.test(discovery)) return discovery;
  if (/^(Evoque|Velar)\b/i.test(discovery)) return `Range Rover ${discovery}`;
  return discovery;
}

/** Normalize a pair together so make aliases cannot discard model information. */
export function normalizeVehicleMakeModel(
  rawMake: string | null | undefined,
  rawModel: string | null | undefined,
): VehicleMakeModel {
  const make = canonicalizeKnownMake(rawMake ?? "");
  const model = normalizeVehicleModel(make, rawModel);
  if (!model) return { make, model };

  const rawMakeKey = normalizeCatalogueName(rawMake ?? "");
  if (rawMakeKey === "rangerover" && !/^(Range Rover|Discovery)\b/i.test(model)) {
    return { make, model: `Range Rover ${model}` };
  }
  if (/^mercedes(?:benz)?amg$/.test(rawMakeKey) && !/\bAMG\b/i.test(model)) {
    return { make, model: `${model} AMG` };
  }
  return { make, model };
}

export function normalizeVehicleModelLookupKey(
  make: string | null | undefined,
  model: string | null | undefined,
): string {
  return normalizeVehicleMakeModel(make, model).model?.toLowerCase() ?? "";
}

/** Trim-only inputs must not be promoted into a different catalogue model. */
export function isUnassignedVehicleModel(model: string): boolean {
  return /^(?:[a-z]|amg line|d sport auto|se p300e a)$/i.test(cleanCatalogueName(model));
}

export function normalizeVehicleAttributeRecord(
  attributes: Readonly<Record<string, string>>,
): Record<string, string> {
  const identity = normalizeVehicleMakeModel(attributes.make, attributes.model);
  return {
    ...attributes,
    ...(attributes.make !== undefined ? { make: identity.make ?? "" } : {}),
    ...(attributes.model !== undefined ? { model: identity.model ?? "" } : {}),
  };
}
