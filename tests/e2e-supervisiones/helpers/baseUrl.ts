// Un solo lugar para el puerto de esta suite (`playwright.supervisiones.config.ts` lo usa como
// `baseURL`/`webServer.url`).
//
// Puerto 4178 (ninguna otra suite lo usa: 4174 e2e-auth, 4175 e2e-clients-sites, 4176
// e2e-assignments, 4177 e2e-checklists, 5173 las que llaman la Edge Function `admin-users` desde
// el navegador) -- esta vía no llama esa Edge Function, así que no necesita el puerto reservado
// en `ALLOWED_ORIGINS` (regla del encargo: "un puerto libre que no sea 5173", el de Mike).
export const E2E_SUPERVISIONES_BASE_URL = 'http://localhost:4178'
