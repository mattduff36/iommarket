import crypto from "crypto";

const HEX_SIGNATURE = /^[0-9a-f]{64}$/;
const TV1_SIGNATURE = /^t=(\d{10,13}),v1=([0-9a-f]{64})$/;

export const RIPPLE_SIGNATURE_MAX_AGE_SECONDS = 15 * 60;

function extractHeader(
  headers: Headers | Record<string, string | undefined>,
  key: string
): string | null {
  if (headers instanceof Headers) {
    return headers.get(key);
  }
  const match = Object.entries(headers).find(
    ([headerKey]) => headerKey.toLowerCase() === key.toLowerCase()
  );
  const value = match?.[1]?.trim();
  return value ? value : null;
}

function safeEqualHex(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(actual, "utf8");
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

export function hashRippleWebhookBody(body: string): string {
  return crypto.createHash("sha256").update(body).digest("hex");
}

export function createRippleWebhookSignature(
  body: string,
  secret: string
): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

export function createRippleWebhookTimestampSignature(
  body: string,
  secret: string,
  timestampSeconds: string | number
): string {
  const timestamp = String(timestampSeconds);
  const digest = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

function hmacHex(secret: string, value: string): string {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function assertFreshTimestamp(raw: string) {
  let timestamp = Number(raw);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Invalid webhook signature");
  }
  if (timestamp > 1_000_000_000_000) {
    timestamp = Math.floor(timestamp / 1000);
  }
  const now = Math.floor(Date.now() / 1000);
  if (timestamp > now + 60) {
    throw new Error("Invalid webhook signature");
  }
  if (now - timestamp > RIPPLE_SIGNATURE_MAX_AGE_SECONDS) {
    throw new Error("Invalid webhook signature");
  }
}

export function describeRippleHmacCandidates(
  body: string,
  headers: Headers | Record<string, string | undefined>,
  secret: string
): { macBody: 0 | 1; macTsBody: 0 | 1; macTsHash: 0 | 1 } {
  const signature = extractHeader(headers, "x-ripple-signature");
  const tv1 = signature?.match(TV1_SIGNATURE);
  const hex = signature && HEX_SIGNATURE.test(signature) ? signature : tv1?.[2];
  if (!hex) {
    return { macBody: 0, macTsBody: 0, macTsHash: 0 };
  }

  const timestamp = tv1?.[1];
  return {
    macBody: safeEqualHex(hmacHex(secret, body), hex) ? 1 : 0,
    macTsBody:
      timestamp && safeEqualHex(hmacHex(secret, `${timestamp}.${body}`), hex)
        ? 1
        : 0,
    macTsHash:
      timestamp &&
      safeEqualHex(
        hmacHex(secret, `${timestamp}.${hashRippleWebhookBody(body)}`),
        hex
      )
        ? 1
        : 0,
  };
}

export function verifyRippleWebhookSignature(
  body: string,
  headers: Headers | Record<string, string | undefined>,
  secret: string
) {
  const signature = extractHeader(headers, "x-ripple-signature");
  if (!signature) {
    throw new Error("Invalid webhook signature");
  }

  if (HEX_SIGNATURE.test(signature)) {
    const expected = createRippleWebhookSignature(body, secret);
    if (!safeEqualHex(expected, signature)) {
      throw new Error("Invalid webhook signature");
    }
    return;
  }

  const tv1 = signature.match(TV1_SIGNATURE);
  if (!tv1) {
    throw new Error("Invalid webhook signature");
  }

  const timestamp = tv1[1];
  const provided = tv1[2];
  assertFreshTimestamp(timestamp);
  const expected = hmacHex(secret, `${timestamp}.${body}`);
  if (!safeEqualHex(expected, provided)) {
    throw new Error("Invalid webhook signature");
  }
}
