/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TELEMETRY_ENABLED?: string;
  readonly VITE_AB_VARIANT?: 'control' | 'treatment';
  readonly VITE_DISCORD_CLIENT_ID?: string;
  readonly VITE_PUBLIC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
