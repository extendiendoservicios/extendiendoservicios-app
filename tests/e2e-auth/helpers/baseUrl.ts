// Un solo lugar para el puerto de esta suite (`playwright.auth.config.ts` lo usa como
// `baseURL`/`webServer.url`; los specs de recuperación lo necesitan aparte para armar el
// `redirectTo` que se le pasa a `admin.generateLink`, antes de que Playwright navegue).
export const E2E_AUTH_BASE_URL = 'http://localhost:4174'
