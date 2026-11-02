import { requireRole } from "@/lib/auth";
import { acceptedAuthHttpStatus } from "@/lib/policy/gate";
import { desktopAccountEnabled } from "@/lib/dealer-stock-sync/desktop-config";
import { createWorkerControlDependencies, readWorkerDashboard } from "@/lib/dealer-stock-sync/worker-control";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;
const headers = { "Cache-Control": "private, no-store, no-transform", "X-Content-Type-Options": "nosniff" };

/** Presence updates independently of the review snapshot, preserving unsaved edits. */
export async function GET(request: Request) {
  try {
    const admin = await requireRole("ADMIN");
    if (!desktopAccountEnabled(process.env, admin.id)) return Response.json({ error: "forbidden" }, { status: 403, headers });
    const deps = createWorkerControlDependencies();
    if (!await deps.desktop.store.consumeRate(`worker-presence-stream:${admin.id}`, 20, 60)) {
      return Response.json({ error: "rate_limited" }, { status: 429, headers: { ...headers, "Retry-After": "60" } });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let removeAbortListener = () => {};
    const stop = () => { stopped = true; clearTimeout(timer); removeAbortListener(); };
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const endAt = Date.now() + 25_000;
        let previous = "";
        const close = () => {
          if (stopped) return;
          stop();
          try { controller.close(); } catch { /* Consumer already cancelled. */ }
        };
        request.signal.addEventListener("abort", close, { once: true });
        removeAbortListener = () => request.signal.removeEventListener("abort", close);
        if (request.signal.aborted) { close(); return; }
        controller.enqueue(encoder.encode("retry: 1000\n\n"));
        const poll = async () => {
          try {
            const snapshot = await readWorkerDashboard(deps, admin.id);
            if (stopped) return;
            const data = JSON.stringify(snapshot);
            if (data !== previous) { controller.enqueue(encoder.encode(`data: ${data}\n\n`)); previous = data; }
            if (Date.now() >= endAt) { close(); return; }
            timer = setTimeout(() => void poll(), 1000);
          } catch { close(); }
        };
        void poll();
      },
      cancel() { stop(); },
    });
    return new Response(stream, { headers: { ...headers, "Content-Type": "text/event-stream", "X-Accel-Buffering": "no" } });
  } catch (error) {
    const status = acceptedAuthHttpStatus(error);
    return Response.json({ error: status === 401 ? "unauthorized" : status === 403 ? "forbidden" : "unavailable" }, { status, headers });
  }
}
