// Un solo lugar para el puerto de esta suite (`playwright.checklists.config.ts` lo usa como
// `baseURL`/`webServer.url`).
//
// Puerto propio 4177 (el primero libre entre los que ya usan las demás suites de backend real:
// 4174 auth, 4175 clients-sites, 4176 assignments, 5173 users/employees/shifts-services): ninguno
// de los flujos de esta suite (`clone_checklist_template`, `update_task_status`,
// `reload_shift_tasks`, `create_shift`, altas/ediciones directas de `checklist_templates`/
// `checklist_template_items`) invoca ninguna Edge Function desde el navegador — son RPC de
// Postgres directas o escritura directa por PostgREST — así que no hace falta el puerto 5173 que
// exige el CORS de `admin-users` (`supabase/functions/_shared/cors.ts`).
export const E2E_CHECKLISTS_BASE_URL = 'http://localhost:4177'
