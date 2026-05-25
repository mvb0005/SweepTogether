/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TELEMETRY_ENABLED?: string;
  readonly VITE_AB_VARIANT?: 'control' | 'treatment';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
