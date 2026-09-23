/// <reference types="vite/client" />
// RESP-009: tipos del módulo virtual que registra el service worker desde React
// (`virtual:pwa-register/react`, usado por `src/app/PwaUpdateProvider.tsx`). `tsconfig.app.json`
// fija `types: ["vite/client"]` a mano, así que sin esta referencia explícita no se suma sola.
/// <reference types="vite-plugin-pwa/react" />

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
