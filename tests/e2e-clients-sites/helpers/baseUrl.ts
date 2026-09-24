// Un solo lugar para el puerto de esta suite (`playwright.clients-sites.config.ts` lo usa como
// `baseURL`/`webServer.url`).
//
// Puerto 4175: no choca con `tests/e2e/` (4173), `tests/e2e-auth/` (4174) ni con el 5173 que usa
// `tests/e2e-users/` (ese puerto lo exige la lista blanca de CORS de la Edge Function
// `admin-users`, además de ser el del servidor de desarrollo de Mike — no tocar). Esta suite no
// llama a ninguna Edge Function: todo el dominio de clientes y sedes es insert/update directo por
// PostgREST (`06_API.md` secciones 4 y 5), así que no tiene esa restricción de origen.
export const E2E_CLIENTS_SITES_BASE_URL = 'http://localhost:4175'
