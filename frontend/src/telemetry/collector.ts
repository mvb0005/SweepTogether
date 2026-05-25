import { Socket } from 'socket.io-client';
import { getExperimentConfig, getOrCreateSessionId, isTelemetryEnabled, resolveVariant } from './experiment';
import { AbVariant, ExperimentConfig, TelemetryEvent } from './types';

const FLUSH_INTERVAL_MS = 5000;
const MAX_BUFFER = 100;

class TelemetryCollector {
  private buffer: TelemetryEvent[] = [];
  private socket: Socket | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  readonly sessionId = getOrCreateSessionId();
  readonly variant: AbVariant = resolveVariant();
  readonly config: ExperimentConfig = getExperimentConfig(this.variant);
  readonly enabled = isTelemetryEnabled();

  bindSocket(socket: Socket | null): void {
    this.socket = socket;
    if (!this.enabled) return;

    if (this.flushTimer) clearInterval(this.flushTimer);
    if (socket) {
      this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    }
  }

  track(name: string, attrs?: TelemetryEvent['attrs'], durationMs?: number): void {
    if (!this.enabled) return;
    this.buffer.push({
      name,
      ts: Date.now(),
      sessionId: this.sessionId,
      variant: this.variant,
      durationMs,
      attrs,
    });
    if (this.buffer.length >= MAX_BUFFER) this.flush();
  }

  trackDuration(name: string, startMs: number, attrs?: TelemetryEvent['attrs']): void {
    this.track(name, attrs, Math.max(0, performance.now() - startMs));
  }

  flush(): void {
    if (!this.enabled || this.buffer.length === 0 || !this.socket?.connected) return;
    const events = this.buffer.splice(0);
    this.socket.emit('telemetryEvents', { sessionId: this.sessionId, variant: this.variant, events });
  }

  dispose(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    this.flush();
  }
}

export const telemetry = new TelemetryCollector();

if (typeof window !== 'undefined' && telemetry.enabled) {
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') telemetry.flush();
  });
  window.addEventListener('pagehide', () => telemetry.flush());
}
