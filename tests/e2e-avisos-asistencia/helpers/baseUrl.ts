// Un solo lugar para el puerto de esta suite (`playwright.avisos-asistencia.config.ts` lo usa
// como `baseURL`/`webServer.url`). Mismo puerto 5173 que el resto de las suites de backend real
// (`tests/e2e-employee-shift/`, `tests/e2e-users/`, etc.): no corren en paralelo entre sí en la
// misma máquina, así que no hay conflicto.
export const E2E_AVISOS_ASISTENCIA_BASE_URL = 'http://localhost:5173'
