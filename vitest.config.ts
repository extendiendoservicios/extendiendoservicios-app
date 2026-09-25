import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Misma inyección de VITE_APP_VERSION que vite.config.ts (ADR-020), para que
// el test de src/lib/appVersion.test.ts corra con el mismo valor que el build.
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string }

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // RESP-009: ver el comentario de `src/test/pwaRegisterReactStub.ts`
      // para por qué hace falta este alias y no alcanza con `vi.mock(...)`
      // solo.
      'virtual:pwa-register/react': fileURLToPath(
        new URL('./src/test/pwaRegisterReactStub.ts', import.meta.url),
      ),
    },
  },
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    // AUTH-001: `src/lib/supabase.ts` corta con un error si estas dos faltan,
    // y lo hace al importarse el módulo. Cualquier test que importe algo que
    // llegue hasta el cliente (por ejemplo `RequireRole`, vía `AuthProvider`)
    // explota antes de correr, aunque tenga `useAuth` mockeado.
    //
    // Sin estas dos líneas, el resultado de `pnpm test` dependía de si quien
    // lo corre tiene `.env.local` — verde en la máquina de desarrollo y rojo
    // en CI, que fue exactamente lo que pasó en el PR de P06.2. Se fijan acá
    // con valores falsos y evidentes, así los tests dan lo mismo en los dos
    // lados y, de paso, ninguna corrida puede pegarle sin querer a App_dev.
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(
      'https://proyecto-de-prueba.supabase.co',
    ),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(
      'sb_publishable_clave-falsa-solo-para-tests',
    ),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // Los specs de tests/e2e/, tests/e2e-auth/, tests/e2e-users/, tests/e2e-clients-sites/,
    // tests/e2e-employees/, tests/e2e-shifts-services/ y tests/e2e-assignments/ son de
    // Playwright, no de Vitest.
    // supabase/functions/**/*.test.ts es Deno (USERS-006, P07.1): usa imports `npm:`/`jsr:` y
    // globals (`Deno.serve`) que Vite no puede resolver -- se corre con `deno test`, no acá (ver
    // `supabase/functions/README.md`).
    exclude: [
      'node_modules/**',
      'tests/e2e/**',
      'tests/e2e-auth/**',
      'tests/e2e-users/**',
      'tests/e2e-clients-sites/**',
      'tests/e2e-employees/**',
      'tests/e2e-shifts-services/**',
      'tests/e2e-assignments/**',
      'supabase/functions/**',
    ],
  },
})
