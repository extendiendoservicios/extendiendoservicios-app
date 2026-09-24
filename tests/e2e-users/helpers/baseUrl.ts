// Un solo lugar para el puerto de esta suite (`playwright.users.config.ts` lo usa como
// `baseURL`/`webServer.url`).
//
// Puerto 5173, NO uno propio como hacen `tests/e2e/` (4173) y `tests/e2e-auth/` (4174):
// `supabase/functions/_shared/cors.ts` (`ALLOWED_ORIGINS`) solo admite `http://localhost:5173`
// como origen local para la Edge Function `admin-users`, además de los dominios de staging y
// producción. `tests/e2e-auth/` nunca lo notó porque nunca llama a `admin-users` desde el
// navegador (usa la Admin API directo con la clave de servicio para todo lo que necesita) — pero
// esta suite SÍ invoca `admin-users` por la interfaz real (`NewAdminUserSheet`,
// `supabase.functions.invoke`), y con cualquier otro puerto el navegador la bloquea con
// `ORIGIN_NOT_ALLOWED` antes de llegar a nada (comprobado en la primera corrida de esta suite:
// el diálogo "Nuevo administrador" se quedaba abierto sin ningún toast de éxito). Usar 5173
// significa que esta suite no puede correr en paralelo con `pnpm dev` en la misma máquina — un
// costo aceptado (regla común 9, "no instales herramientas globales... si hace falta algo más,
// reportalo": acá no hace falta nada más, alcanza con el mismo puerto que ya está en la lista
// blanca) documentado también en el reporte del encargo, con la sugerencia de agregar el puerto
// de `vite preview` de las suites e2e a `ALLOWED_ORIGINS` si esto volviera a ser un problema.
export const E2E_USERS_BASE_URL = 'http://localhost:5173'
