export type AbVariant = 'control' | 'treatment';

export interface ExperimentConfig {
  variant: AbVariant;
  chunkBuffer: number;
  bufferDebounceMs: number;
}

export interface TelemetryEvent {
  name: string;
  ts: number;
  sessionId: string;
  variant: AbVariant;
  durationMs?: number;
  attrs?: Record<string, string | number | boolean>;
}
