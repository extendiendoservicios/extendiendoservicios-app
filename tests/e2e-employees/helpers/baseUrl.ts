// Un solo lugar para el puerto de esta suite (`playwright.employees.config.ts` lo usa como
// `baseURL`/`webServer.url`).
//
// Puerto 5173, igual que `tests/e2e-users/` (ver el comentario largo de su propio
// `helpers/baseUrl.ts`): `supabase/functions/_shared/cors.ts` (`ALLOWED_ORIGINS`) solo admite
// `http://localhost:5173` como origen local para llamar a la Edge Function `admin-users`, y esta
// suite SÍ la invoca por la interfaz real (ADM-18, alta de empleado y supervisor "con usuario
// (Edge `create_user`)", `08_Fases_y_Backlog.md` línea 122) -- con cualquier otro puerto el
// navegador la bloquea con `ORIGIN_NOT_ALLOWED` antes de llegar a nada. Mismo costo aceptado que
// `tests/e2e-users/`: esta suite no puede correr en paralelo con `pnpm dev` en la misma máquina.
export const E2E_EMPLOYEES_BASE_URL = 'http://localhost:5173'
