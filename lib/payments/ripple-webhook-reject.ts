import { buildRippleSafeTags } from "@/lib/payments/ripple-privacy";

export const RIPPLE_HMAC_SHAPES = [
  "missing",
  "hex64",
  "hex64u",
  "hexmix",
  "hexlen",
  "sha256eq",
  "tv1",
  "stdwh",
  "b64",
  "other",
] as const;

export type RippleHmacShape = (typeof RIPPLE_HMAC_SHAPES)[number];

const AUTH_HEADER_ALIASES: Record<string, string> = {
  "x-ripple-signature": "xrpl",
  "ripple-signature": "rsig",
  "x-webhook-signature": "xwhs",
  "webhook-signature": "whsig",
  "webhook-id": "whid",
  "webhook-timestamp": "whts",
  "x-webhook-timestamp": "xwht",
  "x-ripple-timestamp": "xrt",
};

const SHAPE_HEADER_PRIORITY = [
  "x-ripple-signature",
  "ripple-signature",
  "x-webhook-signature",
  "webhook-signature",
] as const;

function headerEntries(
  headers: Headers | Record<string, string | undefined>
): Array<[string, string]> {
  if (headers instanceof Headers) {
    return [...headers.entries()].map(([key, value]) => [
      key.toLowerCase(),
      value.trim(),
    ]);
  }
  return Object.entries(headers)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, value]) => [key.toLowerCase(), value.trim()]);
}

function isCandidateHeaderName(name: string): boolean {
  return /sign|hmac|webhook|^x-ripple/.test(name);
}

export function classifyRippleHmacShape(value: string | null): RippleHmacShape {
  if (!value) return "missing";
  const trimmed = value.trim();
  if (!trimmed) return "missing";
  if (/^[0-9a-f]{64}$/.test(trimmed)) return "hex64";
  if (/^[0-9A-F]{64}$/.test(trimmed)) return "hex64u";
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return "hexmix";
  if (/^[0-9a-fA-F]+$/.test(trimmed)) return "hexlen";
  if (/^sha256=[0-9a-fA-F]{64}$/i.test(trimmed)) return "sha256eq";
  if (/^t=\d+,v1=[0-9a-fA-F]{64}$/i.test(trimmed)) return "tv1";
  if (/^v1,[A-Za-z0-9+/=]+$/.test(trimmed)) return "stdwh";
  if (/^[A-Za-z0-9+/]+=*$/.test(trimmed) && trimmed.length >= 40) return "b64";
  return "other";
}

export function describeRippleWebhookAuth(
  headers: Headers | Record<string, string | undefined>
): {
  hmacShape: RippleHmacShape;
  hmacLen: number;
  authHdrs: string;
  authOther: boolean;
} {
  const entries = headerEntries(headers);
  const byName = new Map(entries);
  const aliases = new Set<string>();
  let authOther = false;

  for (const [name] of entries) {
    const alias = AUTH_HEADER_ALIASES[name];
    if (alias) {
      aliases.add(alias);
      continue;
    }
    if (isCandidateHeaderName(name)) {
      authOther = true;
    }
  }

  let raw: string | null = null;
  for (const name of SHAPE_HEADER_PRIORITY) {
    const value = byName.get(name);
    if (value) {
      raw = value;
      break;
    }
  }

  return {
    hmacShape: classifyRippleHmacShape(raw),
    hmacLen: Math.min(raw?.length ?? 0, 256),
    authHdrs: [...aliases].sort().join(",") || "none",
    authOther,
  };
}

export const RIPPLE_CURRENCY_STATES = [
  "missing",
  "blank",
  "wrongtype",
  "unsupported",
] as const;

export type RippleCurrencyState = (typeof RIPPLE_CURRENCY_STATES)[number];

const CURRENCY_KEY_NAMES = ["currency", "currency_code", "ccy"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function classifyRippleEnvelopeReject(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (error instanceof SyntaxError || /JSON|Unexpected token|Unexpected end/i.test(message)) {
    return "json";
  }
  if (message.includes("Unsupported Ripple webhook event")) return "event";
  if (message.includes("client_id")) return "client";
  if (message.includes("timestamp")) return "time";
  if (message.includes("data must")) return "data";
  if (message.includes("currency")) return "ccy";
  if (message.includes("JSON object")) return "shape";
  return "other";
}

export function describeRippleCurrencyField(payload: unknown): {
  ccyState: RippleCurrencyState;
  ccyCode?: string;
  ccyKeys: string;
} {
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
  const ccyKeys = data
    ? CURRENCY_KEY_NAMES.filter((key) =>
        Object.prototype.hasOwnProperty.call(data, key)
      ).join(",") || "none"
    : "none";

  if (!data || !Object.prototype.hasOwnProperty.call(data, "currency")) {
    return { ccyState: "missing", ccyKeys };
  }

  const value = data.currency;
  if (value === null || value === undefined) {
    return { ccyState: "missing", ccyKeys };
  }
  if (typeof value !== "string") {
    return { ccyState: "wrongtype", ccyKeys };
  }
  if (!value.trim()) {
    return { ccyState: "blank", ccyKeys };
  }

  const code = value.trim().toLowerCase();
  if (/^[a-z]{3}$/.test(code) && code !== "gbp") {
    return { ccyState: "unsupported", ccyCode: code, ccyKeys };
  }
  return { ccyState: "unsupported", ccyKeys };
}

export function rippleRejectMonitoringCopy(input: {
  rejectStage: "hmac" | "envelope";
  envReason?: string;
}): { title: string; message: string } {
  if (input.rejectStage === "hmac") {
    return {
      title: "Ripple webhook rejected",
      message: "Ripple webhook failed the signature check before persist.",
    };
  }
  if (input.envReason === "ccy") {
    return {
      title: "Ripple webhook rejected",
      message: "Ripple webhook failed currency validation before persist.",
    };
  }
  return {
    title: "Ripple webhook rejected",
    message: "Ripple webhook failed payload validation before persist.",
  };
}

export function rippleRejectTags(input: {
  rejectStage: "hmac" | "envelope";
  headers?: Headers | Record<string, string | undefined>;
  envReason?: string;
  ccyState?: RippleCurrencyState;
  ccyCode?: string;
  ccyKeys?: string;
  macBody?: 0 | 1;
  macTsBody?: 0 | 1;
  macTsHash?: 0 | 1;
}): Record<string, string> {
  const auth = input.headers
    ? describeRippleWebhookAuth(input.headers)
    : {
        hmacShape: "missing" as const,
        hmacLen: 0,
        authHdrs: "none",
        authOther: false,
      };

  return buildRippleSafeTags({
    rejectStage: input.rejectStage,
    hmacShape: auth.hmacShape,
    hmacLen: auth.hmacLen,
    authHdrs: auth.authHdrs,
    authOther: auth.authOther ? 1 : 0,
    envReason: input.envReason,
    ccyState: input.ccyState,
    ccyCode: input.ccyCode,
    ccyKeys: input.ccyKeys,
    macBody: input.macBody,
    macTsBody: input.macTsBody,
    macTsHash: input.macTsHash,
  });
}
