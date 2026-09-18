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
    },
  },
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // Los specs de tests/e2e/ son de Playwright, no de Vitest.
    exclude: ['node_modules/**', 'tests/e2e/**'],
  },
})
