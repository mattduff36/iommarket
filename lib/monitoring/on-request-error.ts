import { captureException } from "./capture";
import { isEdgeRuntime, isServerCaptureEnabled } from "./flags";
import { isExpectedControlFlowError } from "./handled";
import { isMonitoringIngestPath, sanitizeRequestPath } from "./redact";

export type RequestErrorLike = Error & { digest?: string };

export type RequestErrorRequest = {
  path: string;
  method: string;
  headers?: Readonly<Record<string, string | string[] | undefined>>;
};

export type RequestErrorContext = {
  routerKind?: string;
  routePath?: string;
  routeType?: string;
  renderSource?: string;
  revalidateReason?: string | undefined;
  renderType?: string;
};

function asRequestError(error: unknown): RequestErrorLike {
  if (error instanceof Error) {
    return error as RequestErrorLike;
  }
  return Object.assign(new Error(typeof error === "string" ? error : "Unknown request error"), {
    digest: error && typeof error === "object" && "digest" in error
      ? String((error as { digest?: unknown }).digest ?? "")
      : undefined,
  });
}

export async function reportRequestError(
  error: unknown,
  request: RequestErrorRequest,
  context: RequestErrorContext,
  deps: {
    captureException?: typeof captureException;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  if (isEdgeRuntime(env) || !isServerCaptureEnabled(env)) return;
  if (isExpectedControlFlowError(error)) return;
  const requestError = asRequestError(error);

  const path = sanitizeRequestPath(request.path);
  if (isMonitoringIngestPath(path)) return;

  const capture = deps.captureException ?? captureException;
  try {
    await capture({
      source: "SERVER",
      error: requestError,
      severity: "HIGH",
      route: sanitizeRequestPath(context.routePath) ?? path,
      requestPath: path,
      requestMethod: request.method,
      action: context.routeType,
      tags: {
        type: "onRequestError",
        routerKind: context.routerKind ?? null,
        routeType: context.routeType ?? null,
        renderSource: context.renderSource ?? null,
        revalidateReason: context.revalidateReason ?? null,
        renderType: context.renderType ?? null,
        digest: requestError.digest ?? null,
      },
    });
  } catch {
    // Monitoring must never alter the original request/error behavior.
  }
}
