/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Versión de la app, inyectada en el build desde `package.json` (ADR-020). */
  readonly VITE_APP_VERSION: string
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_APP_ENV: 'local' | 'staging' | 'production'
  readonly VITE_SENTRY_DSN: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
