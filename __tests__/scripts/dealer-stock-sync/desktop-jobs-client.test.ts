/* @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDesktopJobsClient,
  DESKTOP_REQUEST_INTERVAL_MS,
  DESKTOP_REQUEST_TIMEOUT_MS,
  DESKTOP_STEP_TIMEOUT_MS,
  DesktopJobError,
  type DesktopJobsClient,
  type DesktopLease,
} from "@/scripts/dealer-stock-sync/desktop-jobs-client";

const TOKEN = "a".repeat(43);
const LEASE = "b".repeat(43);
const PREVIEW_URL = "https://itrader.dev/api/stock-worker/jobs";
const PRODUCTION_URL = "https://itrader.im/api/stock-worker/jobs";
const GENERIC = "The iTrader request could not be verified. Check Stock Reviews before starting again; the last request may have completed.";
const UNAUTHORISED = "Desktop authorisation has expired or been revoked. Sign in again.";
const CONFLICT = "The job lease is no longer available. Check Stock Reviews before starting again.";
const RATE_LIMITED = "iTrader asked this device to pause. Wait a minute before starting again.";
const SECRET = "SUPERSECRETVALUE";
const JOB: DesktopLease = { id: "job12345", kind: "SCRAPE", registryKey: "dealer-1", leaseToken: LEASE };
const REQUEST_KEYS = ["body", "cache", "credentials", "headers", "method", "redirect", "signal"];

function pace() {
  let time = 0;
  const waits: number[] = [];
  return {
    waits,
    now: () => time,
    wait: async (ms: number) => {
      waits.push(ms);
      time += ms;
    },
  };
}

function httpResponse(options: {
  url?: string;
  status?: number;
  body?: unknown;
  bytes?: Uint8Array;
  chunks?: Uint8Array[];
  redirected?: boolean;
  contentType?: string | null;
  stream?: ReadableStream<Uint8Array>;
} = {}): Response {
  const status = options.status ?? 200;
  const headers = new Headers();
  if (options.contentType !== null) headers.set("content-type", options.contentType ?? "application/json");
  const bytes = options.bytes ?? Buffer.from(JSON.stringify(options.body ?? {}));
  const stream = options.stream ?? new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of options.chunks ?? [bytes]) controller.enqueue(chunk);
      controller.close();
    },
  });
  return {
    status,
    ok: status >= 200 && status < 300,
    redirected: options.redirected ?? false,
    url: options.url ?? PREVIEW_URL,
    headers,
    body: stream,
  } as Response;
}

function mockFetch(impl: (url: string, init: RequestInit, index: number) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const request = init ?? {};
    calls.push({ url, init: request });
    return Promise.resolve(impl(url, request, calls.length - 1));
  });
  return { calls, fetcher: fetcher as typeof fetch };
}

function clientFor(fetcher: typeof fetch, environment: "preview" | "production" = "preview", timeoutMs?: number) {
  const clock = pace();
  const client = createDesktopJobsClient(environment, TOKEN, {
    fetcher,
    now: clock.now,
    wait: clock.wait,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return { client, clock };
}

async function rejection(promise: Promise<unknown>): Promise<DesktopJobError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DesktopJobError);
    return error as DesktopJobError;
  }
  throw new Error("expected DesktopJobError");
}

function expectRedacted(error: DesktopJobError, reason: DesktopJobError["reason"], message: string) {
  expect(error.reason).toBe(reason);
  expect(error.name).toBe("DesktopJobError");
  expect(error.message).toBe(message);
  expect(error.message).not.toContain(TOKEN);
  expect(error.message).not.toContain(LEASE);
  expect(error.message).not.toContain(SECRET);
  expect(error.message.length).toBeLessThan(300);
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new Error(`live network blocked ${SECRET}`)));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("desktop jobs client requests", () => {
  it("posts only the canonical bearer job URL with a fixed no-credential init", async () => {
    const responses: unknown[] = [
      { ready: true },
      { job: null },
      { job: JOB },
      { status: "extended" },
      { status: "succeeded" },
      { status: "failed" },
      { status: "continue" },
    ];
    const { calls, fetcher } = mockFetch(() => httpResponse({ body: responses.shift() }));
    const { client, clock } = clientFor(fetcher);
    await expect(client.check()).resolves.toBeUndefined();
    await expect(client.lease()).resolves.toBeNull();
    await expect(client.lease()).resolves.toEqual(JOB);
    await expect(client.heartbeat(JOB)).resolves.toBeUndefined();
    await expect(client.submit(JOB, { vehicles: [{ id: "v1" }] })).resolves.toBe("succeeded");
    await expect(client.fail(JOB, "browser_failed")).resolves.toBe("failed");
    await expect(client.step(JOB)).resolves.toBe("continue");

    expect(calls.map(call => call.url)).toEqual(Array(7).fill(PREVIEW_URL));
    expect(calls.map(call => JSON.parse(String(call.init.body)))).toEqual([
      { op: "check" },
      { op: "lease" },
      { op: "lease" },
      { op: "heartbeat", jobId: JOB.id, leaseToken: LEASE },
      { op: "submit", jobId: JOB.id, leaseToken: LEASE, result: { vehicles: [{ id: "v1" }] } },
      { op: "fail", jobId: JOB.id, leaseToken: LEASE, reason: "browser_failed" },
      { op: "step", jobId: JOB.id, leaseToken: LEASE },
    ]);
    for (const call of calls) {
      expect(Object.keys(call.init).sort()).toEqual(REQUEST_KEYS);
      expect(call.init).toMatchObject({
        method: "POST",
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      });
      expect(call.init.signal).toBeInstanceOf(AbortSignal);
      expect(call.init.signal?.aborted).toBe(true);
      expect(String(call.init.body)).not.toContain(TOKEN);
      expect(call.url).not.toContain(TOKEN);
    }
    expect(clock.waits).toEqual(Array(6).fill(DESKTOP_REQUEST_INTERVAL_MS));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("uses the production canonical origin", async () => {
    const { calls, fetcher } = mockFetch(() => httpResponse({ url: PRODUCTION_URL, body: { ready: true } }));
    const { client } = clientFor(fetcher, "production");
    await client.check();
    expect(calls.map(call => call.url)).toEqual([PRODUCTION_URL]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects inherited and unexpected environments before any request", () => {
    const fetcher = vi.fn();
    const names = ["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf", "staging", "preview ", "https://itrader.dev"];
    for (const name of names) {
      expect(() => createDesktopJobsClient(name as "preview", TOKEN, { fetcher: fetcher as typeof fetch })).toThrow(DesktopJobError);
    }
    expect(() => createDesktopJobsClient({ toString: () => "preview" } as unknown as "preview", TOKEN)).toThrow(DesktopJobError);
    expect(() => createDesktopJobsClient("preview", "short")).toThrow(DesktopJobError);
    expect(() => createDesktopJobsClient("preview", `${"a".repeat(42)}.`)).toThrow(DesktopJobError);
    expect(() => createDesktopJobsClient("preview", { toString: () => TOKEN } as unknown as string)).toThrow(DesktopJobError);
    try {
      createDesktopJobsClient("constructor" as "preview", `${SECRET}${"a".repeat(20)}`);
      throw new Error("expected rejection");
    } catch (error) {
      expectRedacted(error as DesktopJobError, "unauthorised", UNAUTHORISED);
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("desktop jobs client response contracts", () => {
  async function rejects(body: unknown, run: (client: DesktopJobsClient) => Promise<unknown>, response: Parameters<typeof httpResponse>[0] = {}) {
    let calls = 0;
    const { fetcher } = mockFetch(() => {
      calls += 1;
      if (calls > 1) return httpResponse({ body: { ready: true } });
      return httpResponse({ body, ...response });
    });
    const { client } = clientFor(fetcher);
    expectRedacted(await rejection(run(client)), "invalid-response", GENERIC);
    expect(calls).toBe(1);
  }

  it("rejects extra secret fields and inexact payloads once", async () => {
    const goodApply = {
      id: "a".repeat(40),
      kind: "APPLY" as const,
      registryKey: `${"a".repeat(39)}-${"b".repeat(40)}`,
      leaseToken: "c".repeat(43),
    };
    const { fetcher } = mockFetch(() => httpResponse({
      body: { job: goodApply },
      contentType: 'application/json; charset="UTF-8"',
    }));
    const { client } = clientFor(fetcher);
    await expect(client.lease()).resolves.toEqual(goodApply);

    await rejects({ ready: true, secret: SECRET }, client => client.check());
    await rejects({ ready: false }, client => client.check());
    await rejects({ ready: "true" }, client => client.check());
    await rejects([{ ready: true }], client => client.check());
    await rejects({ job: { ...JOB, secret: SECRET } }, client => client.lease());
    await rejects({ job: { ...JOB }, secret: SECRET }, client => client.lease());
    await rejects({ job: { ...JOB, kind: "scrape" } }, client => client.lease());
    await rejects({ job: { ...JOB, id: "short" } }, client => client.lease());
    await rejects({ job: { ...JOB, registryKey: "A".repeat(8) } }, client => client.lease());
    await rejects({ job: { ...JOB, leaseToken: `${"c".repeat(42)}+` } }, client => client.lease());
    await rejects({ job: { id: JOB.id, kind: JOB.kind, leaseToken: LEASE } }, client => client.lease());
    await rejects({ status: "extended", secret: SECRET }, client => client.heartbeat(JOB));
    await rejects({ status: "continue" }, client => client.heartbeat(JOB));
    await rejects({ status: "succeeded" }, client => client.fail(JOB, "timed_out"));
    await rejects({ status: "pending" }, client => client.step(JOB));
    await rejects({ ready: true }, client => client.check(), { contentType: "application/json; charset=utf-16" });
    await rejects({ ready: true }, client => client.check(), { contentType: "text/plain" });
    await rejects(undefined, client => client.check(), { bytes: Buffer.from(`{"secret":"${SECRET}"`) });
    await rejects(undefined, client => client.check(), { bytes: Uint8Array.of(0xff, 0xfe, 0x7b) });
    await rejects(undefined, client => client.check(), { contentType: null, bytes: Buffer.from('{"ready":true}') });
  });

  it("returns a failed submit status without throwing or retrying", async () => {
    let calls = 0;
    const { fetcher } = mockFetch(() => {
      calls += 1;
      return httpResponse({ body: calls === 1 ? { status: "failed" } : { status: "succeeded" } });
    });
    const { client } = clientFor(fetcher);
    await expect(client.submit(JOB, { count: 1 })).resolves.toBe("failed");
    expect(calls).toBe(1);
  });

  it.each([
    [401, "unauthorised", UNAUTHORISED],
    [403, "unauthorised", UNAUTHORISED],
    [409, "conflict", CONFLICT],
    [429, "rate-limited", RATE_LIMITED],
    [400, "invalid-request", GENERIC],
    [500, "unavailable", GENERIC],
    [503, "unavailable", GENERIC],
    [302, "unavailable", GENERIC],
  ] as const)("maps HTTP %i to %s without revealing the body or retrying", async (status, reason, message) => {
    let calls = 0;
    const { fetcher } = mockFetch(() => {
      calls += 1;
      if (calls > 1) return httpResponse({ body: { ready: true } });
      return httpResponse({ status, body: { error: SECRET, accessToken: TOKEN } });
    });
    const { client } = clientFor(fetcher);
    expectRedacted(await rejection(client.check()), reason, message);
    expect(calls).toBe(1);
  });

  it("rejects redirects, foreign final URLs, and transport failures once", async () => {
    const cases: Array<() => Response | Promise<Response>> = [
      () => httpResponse({ body: { ready: true }, redirected: true }),
      () => httpResponse({ body: { ready: true }, url: "https://itrader.dev.evil/api/stock-worker/jobs" }),
      () => httpResponse({ body: { ready: true }, url: PRODUCTION_URL }),
      () => { throw new TypeError(`redirect is not allowed ${TOKEN} ${SECRET}`); },
      () => { throw new Error(`socket reset ${TOKEN} ${SECRET}`); },
    ];
    for (const next of cases) {
      let calls = 0;
      const { fetcher } = mockFetch(() => {
        calls += 1;
        if (calls > 1) return httpResponse({ body: { ready: true } });
        return next();
      });
      const { client } = clientFor(fetcher);
      expectRedacted(await rejection(client.check()), "unavailable", GENERIC);
      expect(calls).toBe(1);
    }
  });

  it("accepts a split UTF-8 JSON body and a canonical response URL", async () => {
    const { fetcher } = mockFetch(() => httpResponse({
      chunks: [Buffer.from('{"ready":'), Buffer.from("true}")],
      contentType: "application/json; charset=utf-8",
    }));
    const { client } = clientFor(fetcher);
    await expect(client.check()).resolves.toBeUndefined();
  });
});

describe("desktop jobs client bounds, deadlines, pacing, and stop", () => {
  it("accepts a 64KiB JSON body and rejects the next streamed byte once", async () => {
    const core = '{"ready":true}';
    const exact = Buffer.from(core + " ".repeat(65_536 - Buffer.byteLength(core)));
    expect(exact.byteLength).toBe(65_536);
    const split = [exact.subarray(0, 1000), exact.subarray(1000)];
    const { fetcher } = mockFetch(() => httpResponse({ chunks: split }));
    const { client } = clientFor(fetcher);
    await expect(client.check()).resolves.toBeUndefined();

    let calls = 0;
    const over = mockFetch(() => {
      calls += 1;
      if (calls > 1) return httpResponse({ body: { ready: true } });
      return httpResponse({ chunks: [exact, Buffer.from(" ")] });
    });
    const bounded = clientFor(over.fetcher);
    expectRedacted(await rejection(bounded.client.check()), "invalid-response", GENERIC);
    expect(calls).toBe(1);
  });

  it("sends a 2MiB submit body and does not send or retry a larger one", async () => {
    const envelope = JSON.stringify({ op: "submit", jobId: JOB.id, leaseToken: LEASE, result: "" });
    const room = (2 * 1024 * 1024) - Buffer.byteLength(envelope);
    let calls = 0;
    const { fetcher, calls: requests } = mockFetch(() => {
      calls += 1;
      return httpResponse({ body: { status: "succeeded" } });
    });
    const { client } = clientFor(fetcher);
    await expect(client.submit(JOB, "a".repeat(room))).resolves.toBe("succeeded");
    expect(Buffer.byteLength(String(requests[0].init.body), "utf8")).toBe(2 * 1024 * 1024);
    expect(calls).toBe(1);

    const error = await rejection(client.submit(JOB, "a".repeat(room + 1)));
    expectRedacted(error, "invalid-request", GENERIC);
    expect(calls).toBe(1);

    const circular: Record<string, unknown> = { secret: SECRET };
    circular.self = circular;
    expectRedacted(await rejection(client.submit(JOB, circular)), "invalid-request", GENERIC);
    expect(calls).toBe(1);
  });

  it("caps ordinary and step deadlines and aborts one in-flight request", async () => {
    expect(DESKTOP_REQUEST_TIMEOUT_MS).toBe(60_000);
    expect(DESKTOP_STEP_TIMEOUT_MS).toBe(240_000);
    expect(DESKTOP_REQUEST_INTERVAL_MS).toBe(1_200);
    const delays: number[] = [];
    const real = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const ms = timeout ?? 0;
      delays.push(ms);
      return real(handler as never, ms >= 1_000 ? 0 : ms, ...(args as []));
    }) as unknown as typeof setTimeout);
    try {
      let calls = 0;
      let aborted = 0;
      const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        calls += 1;
        if (calls > 3) return Promise.resolve(httpResponse({ body: { ready: true } }));
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted += 1;
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          }, { once: true });
        });
      }) as typeof fetch;
      const ordinary = clientFor(fetcher);
      expectRedacted(await rejection(ordinary.client.check()), "unavailable", GENERIC);
      const raised = clientFor(fetcher, "preview", 1_000_000);
      expectRedacted(await rejection(raised.client.check()), "unavailable", GENERIC);
      const step = clientFor(fetcher, "preview", 1_000_000);
      expectRedacted(await rejection(step.client.step(JOB)), "unavailable", GENERIC);
      expect(calls).toBe(3);
      expect(aborted).toBe(3);
      expect(delays.filter(ms => ms >= 60_000)).toEqual([60_000, 60_000, 240_000]);
    } finally {
      spy.mockRestore();
    }
  });

  it("includes a stalled response stream in the total deadline", async () => {
    let calls = 0;
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      signal = init?.signal ?? undefined;
      if (calls > 1) return Promise.resolve(httpResponse({ body: { ready: true } }));
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const timer = setTimeout(() => {
            try {
              controller.enqueue(Buffer.from('{"ready":true}'));
              controller.close();
            } catch { /* deadline already closed the stream */ }
          }, 5_000);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            try { controller.error(Object.assign(new Error(`stalled ${SECRET}`), { name: "AbortError" })); }
            catch { /* already closed */ }
          }, { once: true });
        },
      });
      return Promise.resolve(httpResponse({ stream }));
    }) as typeof fetch;
    const started = Date.now();
    const { client } = clientFor(fetcher, "preview", 80);
    expectRedacted(await rejection(client.check()), "unavailable", GENERIC);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(calls).toBe(1);
    expect(signal?.aborted).toBe(true);
  });

  it("serialises overlapping calls and paces the later one", async () => {
    let release: (response: Response) => void = () => {};
    const gate = new Promise<Response>(resolve => { release = resolve; });
    let calls = 0;
    const fetcher = vi.fn(() => {
      calls += 1;
      return calls === 1 ? gate : Promise.resolve(httpResponse({ body: { ready: true } }));
    }) as typeof fetch;
    const { client, clock } = clientFor(fetcher);
    const first = client.check();
    const second = client.check();
    await vi.waitFor(() => expect(calls).toBe(1));
    release(httpResponse({ body: { ready: true } }));
    await first;
    await second;
    expect(calls).toBe(2);
    expect(clock.waits).toEqual([1_200]);
  });

  it("observes a lease stop that happens during pacing before HTTP", async () => {
    let time = 0;
    const waits: number[] = [];
    let stopped = false;
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      return httpResponse({ body: { ready: true } });
    }) as typeof fetch;
    const client = createDesktopJobsClient("preview", TOKEN, {
      fetcher,
      now: () => time,
      wait: async (ms: number) => {
        waits.push(ms);
        stopped = true;
        time += ms;
      },
    });
    await client.check();
    await expect(client.lease(() => stopped)).resolves.toBeNull();
    expect(calls).toBe(1);
    expect(waits).toEqual([1_200]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("keeps pacing stopped leases after the previous interval has elapsed", async () => {
    let time = 0;
    const waits: number[] = [];
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      return httpResponse({ body: { job: { ...JOB, secret: SECRET } } });
    }) as typeof fetch;
    const client = createDesktopJobsClient("preview", TOKEN, {
      fetcher,
      now: () => time,
      wait: async (ms: number) => {
        waits.push(ms);
        time += ms;
      },
    });
    await expect(client.lease(() => true)).resolves.toBeNull();
    await expect(client.lease(() => true)).resolves.toBeNull();
    expect(calls).toBe(0);
    expect(waits).toEqual([1_200]);
  });

  it("does not retry an ambiguous transport failure before the next explicit call", async () => {
    let calls = 0;
    const { fetcher } = mockFetch(() => {
      calls += 1;
      if (calls === 1) throw new Error(`socket reset ${TOKEN} ${SECRET}`);
      return httpResponse({ body: { ready: true } });
    });
    const { client, clock } = clientFor(fetcher);
    expectRedacted(await rejection(client.check()), "unavailable", GENERIC);
    expect(calls).toBe(1);
    await client.check();
    expect(calls).toBe(2);
    expect(clock.waits).toEqual([1_200]);
  });
});
