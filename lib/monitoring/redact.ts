const SENSITIVE_KEY_REGEX =
  /(password|token|secret|authorization|cookie|api[_-]?key|signature|webhook|set-cookie)/i;

const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 4000;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER_RE = /bearer\s+[a-z0-9._\-+=/~]+/gi;
const JWT_RE = /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g;
const AUTH_HEADER_RE =
  /authorization\s*[:=]\s*(?:(?:basic|bearer|token)\s+\S+|digest\s+.+?(?=\s+(?:https?:\/\/|(?:cookie|set-cookie|authorization)\s*[:=])|$)|[^\s,]+)/gi;
const COOKIE_HEADER_PREFIX_RE = /(?:cookie|set-cookie)\s*[:=]\s*/gi;
const COOKIE_BLOCK_TERMINATOR_RE = /^(https?:\/\/|authorization\s*[:=]|bearer\s+)/i;
const COOKIE_PAIR_RE =
  /^(\s*)([^=;\s]+)\s*=\s*("(?:\\.|[^"\\])*"|[^;]*?)(?=\s*;|\s+https?:\/\/|\s+authorization\s*[:=]|\s+bearer\s+|$)/i;
const SENSITIVE_COOKIE_PAIR_RE =
  /(?:^|[;\s])([^=;\s]*(?:session|token|auth|sid)[^=;\s]*)\s*=\s*(?:"(?:\\.|[^"\\])*"|[^;\s]*)/gi;
const QUERY_SECRET_RE =
  /([?&](?:token|access_token|refresh_token|id_token|api[_-]?key|signature|auth|password|secret|session)=)[^&#\s]+/gi;

function maskEmail(input: string): string {
  const parts = input.split("@");
  if (parts.length !== 2) return input;
  const [local, domain] = parts;
  if (local.length <= 2) return `**@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

function redactCookieHeaderBlocks(input: string): string {
  const prefixRe = new RegExp(COOKIE_HEADER_PREFIX_RE.source, "gi");
  let output = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = prefixRe.exec(input)) !== null) {
    output += input.slice(lastIndex, match.index + match[0].length);
    let cursor = match.index + match[0].length;

    while (cursor < input.length) {
      const remaining = input.slice(cursor);
      if (COOKIE_BLOCK_TERMINATOR_RE.test(remaining.trimStart())) {
        break;
      }

      const pair = remaining.match(COOKIE_PAIR_RE);
      if (!pair) break;

      output += `${pair[1]}${pair[2]}=[redacted]`;
      cursor += pair[0].length;

      const separator = input.slice(cursor).match(/^\s*;/);
      if (!separator) break;
      output += separator[0];
      cursor += separator[0].length;
    }

    lastIndex = cursor;
    prefixRe.lastIndex = cursor;
  }

  return output + input.slice(lastIndex);
}

export function redactFreeText(value: string): string {
  let result = value.trim();
  if (result.length > MAX_STRING_LENGTH) {
    result = `${result.slice(0, MAX_STRING_LENGTH)}…[truncated]`;
  }

  result = result.replace(QUERY_SECRET_RE, "$1[redacted]");
  result = result.replace(BEARER_RE, "Bearer [redacted]");
  result = result.replace(AUTH_HEADER_RE, (match) =>
    /bearer\s+\[redacted\]/i.test(match) ? match : "authorization=[redacted]",
  );
  result = result.replace(JWT_RE, "[redacted-jwt]");
  result = redactCookieHeaderBlocks(result);
  result = result.replace(SENSITIVE_COOKIE_PAIR_RE, (match, name: string) => {
    const prefix = match.startsWith(";") || match.startsWith(" ") ? match[0] : "";
    return `${prefix}${name}=[redacted]`;
  });
  result = result.replace(EMAIL_RE, (email) => maskEmail(email));
  return result;
}

function redactStringValue(value: string): string {
  const trimmed = value.trim();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
    return maskEmail(trimmed);
  }
  return redactFreeText(value);
}

function redactUnknown(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return "[max-depth]";
  if (value === null || value === undefined) return value;

  if (typeof value === "string") return redactStringValue(value);
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => redactUnknown(item, depth + 1));
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    for (const [key, nested] of Object.entries(obj)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = redactUnknown(nested, depth + 1);
      }
    }

    return out;
  }

  return String(value);
}

export function redactMonitoringPayload(
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!payload) return undefined;
  return redactUnknown(payload, 0) as Record<string, unknown>;
}

export function redactStack(stack?: string | null): string | null {
  if (!stack) return null;
  return stack
    .split("\n")
    .slice(0, 40)
    .map((line) => redactFreeText(line).slice(0, 500))
    .join("\n");
}

export function sanitizeRequestPath(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  const withoutOrigin = path.replace(/^https?:\/\/[^/]+/i, "");
  const pathname = withoutOrigin.split("#")[0] ?? "";
  return redactFreeText(pathname);
}

export function isMonitoringIngestPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const normalized = path.split("?")[0]?.toLowerCase() ?? "";
  return normalized.includes("/api/monitoring/events");
}
