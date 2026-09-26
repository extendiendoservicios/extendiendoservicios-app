// Un solo lugar para el puerto de esta suite (`playwright.employee-shift.config.ts` lo usa como
// `baseURL`/`webServer.url`).
//
// Puerto 5173 (mismo que `tests/e2e-users/`, `tests/e2e-employees/` y
// `tests/e2e-shifts-services/`, ver el comentario largo de sus propios `helpers/baseUrl.ts`):
// aunque esta suite no invoca la Edge Function `admin-users` desde el navegador (el empleado de
// fixture se crea con la clave de servicio, no por el alta real de ADM-18), el encargo P13.4 pide
// este puerto a propósito -- consistente con el resto de la app en desarrollo, y sin sorpresas si
// alguna pantalla nueva de esta vía termina llamando esa Edge Function en el futuro.
export const E2E_EMPLOYEE_SHIFT_BASE_URL = 'http://localhost:5173'
