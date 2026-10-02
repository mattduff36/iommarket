type HeaderValue = string | string[] | undefined;
type HeaderBag = Readonly<Record<string, HeaderValue>> | undefined;

function readHeader(headers: HeaderBag, name: string): string | undefined {
  if (!headers) return undefined;
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

export function monitoringRequestContext(headers: HeaderBag): {
  requestId?: string;
  traceId?: string;
} {
  const requestId = readHeader(headers, "x-request-id") ?? readHeader(headers, "x-vercel-id");
  const traceparent = readHeader(headers, "traceparent");
  const traceId = traceparent?.split("-")[1];
  return {
    requestId: requestId?.slice(0, 200),
    traceId: traceId?.slice(0, 200),
  };
}

export function vercelLogsUrl(requestId: string | null | undefined, baseUrl?: string): string {
  const base = baseUrl?.trim() || "https://vercel.com/mpdees-projects/iommarket/logs";
  const url = new URL(base);
  if (requestId) url.searchParams.set("query", requestId);
  return url.toString();
}
