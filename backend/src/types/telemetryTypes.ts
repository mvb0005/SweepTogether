export interface TelemetryEvent {
  name: string;
  ts: number;
  sessionId: string;
  variant: string;
  durationMs?: number;
  attrs?: Record<string, string | number | boolean>;
}

export interface TelemetryBatchPayload {
  sessionId: string;
  variant: string;
  events: TelemetryEvent[];
}
