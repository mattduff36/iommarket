export type MonitoringSource = "SERVER" | "CLIENT" | "WEBHOOK" | "BUSINESS";

export type MonitoringSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface MonitoringContext {
  title?: string;
  environment?: string;
  route?: string;
  action?: string;
  component?: string;
  requestMethod?: string;
  requestPath?: string;
  requestId?: string;
  userId?: string;
  userEmail?: string;
  ipHash?: string;
  tags?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

export interface CaptureExceptionInput extends MonitoringContext {
  source: MonitoringSource;
  error: unknown;
  severity?: MonitoringSeverity;
}

export interface CaptureBusinessEventInput extends MonitoringContext {
  source?: MonitoringSource;
  message: string;
  severity?: MonitoringSeverity;
}

export interface CapturedMonitoringEvent {
  issueId: string;
  eventId: string;
  fingerprint: string;
  createdIssue: boolean;
}
