import { TelemetryEvent } from '../types/telemetryTypes';

interface Aggregate {
  count: number;
  totalDurationMs: number;
  durationSamples: number;
}

export class TelemetryService {
  private aggregates = new Map<string, Aggregate>();

  private key(variant: string, name: string): string {
    return `${variant}:${name}`;
  }

  ingest(events: TelemetryEvent[]): void {
    for (const event of events) {
      const k = this.key(event.variant, event.name);
      const agg = this.aggregates.get(k) ?? { count: 0, totalDurationMs: 0, durationSamples: 0 };
      agg.count++;
      if (event.durationMs !== undefined) {
        agg.totalDurationMs += event.durationMs;
        agg.durationSamples++;
      }
      this.aggregates.set(k, agg);
    }
  }

  logBatch(sessionId: string, variant: string, count: number): void {
    console.log(`[telemetry] session=${sessionId} variant=${variant} batch=${count}`);
  }

  logPeriodicSummary(): void {
    if (this.aggregates.size === 0) return;
    const lines: string[] = [];
    for (const [k, agg] of this.aggregates.entries()) {
      const avg = agg.durationSamples > 0
        ? (agg.totalDurationMs / agg.durationSamples).toFixed(1)
        : '-';
      lines.push(`${k} count=${agg.count} avgMs=${avg}`);
    }
    console.log(`[telemetry:summary] ${lines.join(' | ')}`);
  }
}

export const telemetryService = new TelemetryService();
