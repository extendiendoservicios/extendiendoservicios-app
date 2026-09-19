import { defineConfig, devices } from '@playwright/test'

// Proyectos chromium, webkit y mobile (viewport 390 px) sobre `pnpm preview`.
//
// INFRA-015/INFRA-016/INFRA-017: `ci.yml` corre esta suite con `--project=chromium` contra el
// build local (sin PLAYWRIGHT_SMOKE_URL, usa `pnpm preview` de acá abajo). `deploy-staging.yml`
// y `deploy-production.yml` la reutilizan como smoke test contra la URL ya publicada, pasando
// `PLAYWRIGHT_SMOKE_URL`: en ese caso no hay que levantar ni esperar un `pnpm preview` local
// (por eso `webServer` se omite cuando la variable está presente).
const smokeUrl = process.env.PLAYWRIGHT_SMOKE_URL

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: smokeUrl ?? 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  ...(smokeUrl
    ? {}
    : {
        webServer: {
          command: 'pnpm preview',
          url: 'http://localhost:4173',
          reuseExistingServer: !process.env.CI,
        },
      }),
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
})
