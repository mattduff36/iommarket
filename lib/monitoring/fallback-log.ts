export interface MonitoringFallbackEvent {
  kind: string;
  message: string;
  issueId?: string;
  eventId?: string;
  route?: string;
}

const state = { depth: 0 };

export function logMonitoringFallback(event: MonitoringFallbackEvent): void {
  if (state.depth > 0) return;
  state.depth += 1;
  try {
    console.error(JSON.stringify({
      monitoringFallback: true,
      at: new Date().toISOString(),
      kind: event.kind,
      message: event.message.slice(0, 500),
      issueId: event.issueId,
      eventId: event.eventId,
      route: event.route,
    }));
  } finally {
    state.depth -= 1;
  }
}
