import React, { createContext, useContext, useEffect } from 'react';
import { useSocket } from '../hooks/useSocket';
import { telemetry } from '../telemetry/collector';
import { ExperimentConfig, TelemetryEvent } from '../telemetry/types';

interface TelemetryContextValue {
  enabled: boolean;
  config: ExperimentConfig;
  sessionId: string;
  track: (name: string, attrs?: TelemetryEvent['attrs'], durationMs?: number) => void;
  trackDuration: (name: string, startMs: number, attrs?: TelemetryEvent['attrs']) => void;
}

const TelemetryContext = createContext<TelemetryContextValue | null>(null);

export const TelemetryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { socket } = useSocket();

  useEffect(() => {
    telemetry.bindSocket(socket);
    if (telemetry.enabled) {
      telemetry.track('session_start', {
        chunkBuffer: telemetry.config.chunkBuffer,
        bufferDebounceMs: telemetry.config.bufferDebounceMs,
      });
    }
    return () => telemetry.dispose();
  }, [socket]);

  const value: TelemetryContextValue = {
    enabled: telemetry.enabled,
    config: telemetry.config,
    sessionId: telemetry.sessionId,
    track: (name, attrs, durationMs) => telemetry.track(name, attrs, durationMs),
    trackDuration: (name, startMs, attrs) => telemetry.trackDuration(name, startMs, attrs),
  };

  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>;
};

export function useTelemetry(): TelemetryContextValue {
  const ctx = useContext(TelemetryContext);
  if (!ctx) throw new Error('useTelemetry must be used within TelemetryProvider');
  return ctx;
}
