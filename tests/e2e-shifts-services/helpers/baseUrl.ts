// Un solo lugar para el puerto de esta suite (`playwright.shifts-services.config.ts` lo usa
// como `baseURL`/`webServer.url`).
//
// Puerto 5173, igual que `tests/e2e-users/` y `tests/e2e-employees/` (ver el comentario largo
// de sus propios `helpers/baseUrl.ts`): `supabase/functions/_shared/cors.ts`
// (`ALLOWED_ORIGINS`) solo admite `http://localhost:5173` como origen local para llamar a la
// Edge Function `admin-users`, y `permissions-interface.spec.ts` SÍ la invoca por la interfaz
// real (el dueño crea un administrador descartable para los casos de permisos por capacidad,
// mismo patrón que `tests/e2e-users/owner-creates-admin-and-capabilities.spec.ts`) — con
// cualquier otro puerto el navegador la bloquea con `ORIGIN_NOT_ALLOWED` antes de llegar a nada.
// El resto de los specs de esta carpeta no necesitan ese puerto en particular, pero comparten
// config (un solo `webServer`): mismo costo aceptado que las otras suites, no corre en paralelo
// con `pnpm dev` en la misma máquina.
export const E2E_SHIFTS_SERVICES_BASE_URL = 'http://localhost:5173'
