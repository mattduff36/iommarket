import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { reportRequestError } from "@/lib/monitoring/on-request-error";

describe("MON-CAPTURE-001 / MON-RUNTIME-001 onRequestError", () => {
  it("captures sanitized App Router context and excludes headers/cookies", async () => {
    const captureException = vi.fn().mockResolvedValue(null);

    await reportRequestError(
      Object.assign(new Error("Render exploded for alice@example.com"), {
        digest: "abc123",
      }),
      {
        path: "/listings/123?access_token=secret",
        method: "GET",
        headers: {
          cookie: "session=abc",
          authorization: "Bearer hidden",
        },
      },
      {
        routerKind: "App Router",
        routePath: "/listings/[id]",
        routeType: "render",
        renderSource: "react-server-components",
        revalidateReason: undefined,
        renderType: "dynamic",
      },
      {
        captureException,
        env: { NEXT_RUNTIME: "nodejs", MONITORING_CAPTURE_SERVER: "1" },
      },
    );

    expect(captureException).toHaveBeenCalledTimes(1);
    const input = captureException.mock.calls[0]?.[0];
    expect(input.source).toBe("SERVER");
    expect(input.requestMethod).toBe("GET");
    expect(input.requestPath).toBe("/listings/123?access_token=[redacted]");
    expect(input.action).toBe("render");
    expect(input.tags).toMatchObject({
      type: "onRequestError",
      routeType: "render",
      routerKind: "App Router",
    });
    expect(JSON.stringify(input)).not.toContain("session=abc");
    expect(JSON.stringify(input)).not.toContain("Bearer hidden");
    expect(JSON.stringify(input)).not.toContain("secret");
  });

  it("does not change error propagation for control-flow or ingest paths", async () => {
    const captureException = vi.fn();
    const redirect = Object.assign(new Error("Redirect"), {
      digest: "NEXT_REDIRECT;replace;/account;307",
    });

    await expect(
      reportRequestError(
        redirect,
        { path: "/account", method: "GET" },
        { routeType: "render" },
        { captureException, env: { NEXT_RUNTIME: "nodejs" } },
      ),
    ).resolves.toBeUndefined();

    await expect(
      reportRequestError(
        new Error("loop"),
        { path: "/api/monitoring/events", method: "POST" },
        { routeType: "route" },
        { captureException, env: { NEXT_RUNTIME: "nodejs" } },
      ),
    ).resolves.toBeUndefined();

    expect(captureException).not.toHaveBeenCalled();
  });
});

describe("MON-RUNTIME-002 edge/runtime guard", () => {
  it("skips capture on Edge and does not import Prisma from instrumentation", async () => {
    const captureException = vi.fn();
    await reportRequestError(
      new Error("edge boom"),
      { path: "/sell", method: "GET" },
      { routeType: "render" },
      { captureException, env: { NEXT_RUNTIME: "edge" } },
    );
    expect(captureException).not.toHaveBeenCalled();

    const source = readFileSync(resolve(process.cwd(), "instrumentation.ts"), "utf8");
    expect(source).not.toMatch(/from ["']@\/lib\/db["']/);
    expect(source).not.toMatch(/from ["']@\/lib\/monitoring\/capture["']/);
    expect(source).toContain('process.env.NEXT_RUNTIME === "edge"');
    expect(source).toContain('require("./instrumentation-node")');
  });
});
