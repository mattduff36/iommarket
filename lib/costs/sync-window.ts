export const INFRA_SLICE_MS = 7 * 24 * 60 * 60 * 1000;
export const INFRA_OVERLAP_MS = 24 * 60 * 60 * 1000;

export function nextInfrastructureSlice(input: {
  startedAt: Date;
  now: Date;
  lastSuccessfulTo: Date | null;
}): { from: Date; to: Date; caughtUp: boolean } {
  const nowMs = input.now.getTime();
  const startedMs = input.startedAt.getTime();
  if (nowMs <= startedMs) {
    return { from: input.startedAt, to: input.now, caughtUp: true };
  }

  const lastMs = input.lastSuccessfulTo?.getTime() ?? null;
  if (lastMs === null || lastMs < startedMs) {
    const toMs = Math.min(nowMs, startedMs + INFRA_SLICE_MS);
    return {
      from: input.startedAt,
      to: new Date(toMs),
      caughtUp: toMs >= nowMs,
    };
  }

  if (lastMs >= nowMs - INFRA_OVERLAP_MS) {
    return {
      from: new Date(Math.max(startedMs, nowMs - INFRA_SLICE_MS)),
      to: input.now,
      caughtUp: true,
    };
  }

  const fromMs = Math.max(startedMs, lastMs - INFRA_OVERLAP_MS);
  const toMs = Math.min(nowMs, fromMs + INFRA_SLICE_MS);
  return {
    from: new Date(fromMs),
    to: new Date(toMs),
    caughtUp: toMs >= nowMs,
  };
}
