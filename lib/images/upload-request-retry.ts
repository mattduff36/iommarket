/** Retry only a rejected intent request, or idempotent verification. Never replay a provider upload token. */
export async function fetchUploadRequest(
  url: string,
  init: RequestInit,
  options: { verification?: boolean } = {},
): Promise<Response> {
  const maxAttempts = 4;
  const maxWaitMs = 180_000;
  let waitedMs = 0;
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init, signal: AbortSignal.timeout(options.verification ? 130_000 : 30_000),
      });
    } catch (error) {
      // An intent may have been created after a lost response; do not create another automatically.
      if (!options.verification || attempt >= maxAttempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1_000 * 2 ** attempt));
      continue;
    }
    const retryable = response.status === 429 ||
      (options.verification && [500, 502, 503, 504].includes(response.status));
    if (!retryable || attempt >= maxAttempts - 1) return response;
    const payload = await response.clone().json().catch(() => null);
    if (payload?.retryable === false) return response;
    const header = response.headers.get("Retry-After");
    const headerMs = header === null ? 0 : /^\d+(?:\.\d+)?$/.test(header)
      ? Number(header) * 1_000 : Date.parse(header) - Date.now();
    const bodyMs = typeof payload?.retryAfterSeconds === "number" ? payload.retryAfterSeconds * 1_000 : 0;
    const delay = Math.max(1_000 * 2 ** attempt,
      Number.isFinite(headerMs) ? headerMs : 0, Number.isFinite(bodyMs) ? bodyMs : 0);
    if (waitedMs + delay > maxWaitMs) return response;
    waitedMs += delay;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}
