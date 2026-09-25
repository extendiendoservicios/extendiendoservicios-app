// Un solo lugar para el puerto de esta suite (`playwright.assignments.config.ts` lo usa como
// `baseURL`/`webServer.url`).
//
// Puerto propio 4176 (el primero libre entre los que ya usan las demás suites de backend real:
// 4174 auth, 4175 clients-sites, 5173 users/employees/shifts-services): ninguno de los flujos de
// asignaciones (`assign_employee`, `remove_assignment`, `update_assignment_time`,
// `update_shift_details`, `cancel_shift`) invoca ninguna Edge Function desde el navegador -- son
// RPC de Postgres directas -- así que no hace falta el puerto 5173 que exige el CORS de
// `admin-users` (`supabase/functions/_shared/cors.ts`). El admin descartable que usan los
// specs de permisos se crea directo con la clave de servicio (`helpers/adminClient.ts`), sin
// pasar por esa Edge Function.
export const E2E_ASSIGNMENTS_BASE_URL = 'http://localhost:4176'
