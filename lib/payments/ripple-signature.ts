import crypto from "crypto";

const HEX_SIGNATURE = /^[0-9a-f]{64}$/;

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

export function verifyRippleWebhookSignature(
  body: string,
  headers: Headers | Record<string, string | undefined>,
  secret: string
) {
  const signature = extractHeader(headers, "x-ripple-signature");
  if (!signature || !HEX_SIGNATURE.test(signature)) {
    throw new Error("Invalid webhook signature");
  }

  const expected = createRippleWebhookSignature(body, secret);
  if (!safeEqualHex(expected, signature)) {
    throw new Error("Invalid webhook signature");
  }
}
