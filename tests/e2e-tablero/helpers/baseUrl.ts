// Un solo lugar para el puerto de esta suite (`playwright.tablero.config.ts` lo usa como
// `baseURL`/`webServer.url`). Mismo puerto 5173 que el resto de las suites de backend real: no
// corren en paralelo entre sí en la misma máquina.
export const E2E_TABLERO_BASE_URL = 'http://localhost:5173'
