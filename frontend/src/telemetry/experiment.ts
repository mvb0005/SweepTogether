import { AbVariant, ExperimentConfig } from './types';

const STORAGE_KEY = 'sweep_ab_variant';
const SESSION_KEY = 'sweep_telemetry_session';

const LEGACY: Omit<ExperimentConfig, 'variant'> = {
  chunkBuffer: 12,
  bufferDebounceMs: 0,
};

const OPTIMIZED: Omit<ExperimentConfig, 'variant'> = {
  chunkBuffer: 12,
  bufferDebounceMs: 150,
};

export function isTelemetryEnabled(): boolean {
  const flag = import.meta.env.VITE_TELEMETRY_ENABLED;
  if (flag === 'false') return false;
  if (flag === 'true') return true;
  return import.meta.env.DEV;
}

function parseVariant(value: string | null): AbVariant | null {
  if (value === 'control' || value === 'treatment') return value;
  return null;
}

export function resolveVariant(): AbVariant {
  const forced = parseVariant(new URLSearchParams(window.location.search).get('ab'));
  if (forced) {
    localStorage.setItem(STORAGE_KEY, forced);
    return forced;
  }

  const envForced = parseVariant(import.meta.env.VITE_AB_VARIANT ?? null);
  if (envForced) return envForced;

  const stored = parseVariant(localStorage.getItem(STORAGE_KEY));
  if (stored) return stored;

  const assigned: AbVariant = Math.random() < 0.5 ? 'control' : 'treatment';
  localStorage.setItem(STORAGE_KEY, assigned);
  return assigned;
}

export function getExperimentConfig(variant: AbVariant): ExperimentConfig {
  const base = variant === 'control' ? LEGACY : OPTIMIZED;
  return { variant, ...base };
}

export function getOrCreateSessionId(): string {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}
