import { sleep } from "./rate-limit";

export class PublicReadStatusError extends Error {
  constructor(readonly status: number) {
    super(`Public website returned HTTP ${status}`);
  }
}

function transient(error: unknown) {
  if (error instanceof PublicReadStatusError) return [408, 429].includes(error.status) || error.status >= 500;
  if (!(error instanceof Error)) return false;
  return ["TimeoutError", "AbortError"].includes(error.name) ||
    /fetch failed|network|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ERR_CONNECTION|ERR_TIMED_OUT|timeout.*exceeded/i.test(error.message);
}

/** Public reads only. Never use this around a lease, submission or mutation. */
export async function retryPublicRead<T>(read: () => Promise<T>, wait = sleep): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await read(); }
    catch (error) {
      if (attempt >= 2 || !transient(error)) throw error;
      await wait(500 * (attempt + 1));
    }
  }
}
