/**
 * Reemplazo de `virtual:pwa-register/react` para los tests (RESP-009).
 *
 * Ese módulo es "virtual": lo arma en memoria el plugin `vite-plugin-pwa`
 * cuando está agregado a la configuración de Vite, y `vitest.config.ts` no
 * lo agrega a propósito (no hace falta un service worker de verdad para
 * correr los tests, y agregar el plugin ahí metería de rebote el manifest,
 * los íconos y el resto del armado de la PWA en cualquier test). Sin este
 * alias (`vitest.config.ts`, `resolve.alias`), `src/app/PwaUpdateProvider.tsx`
 * no puede ni transformarse bajo Vitest: la resolución del import falla
 * antes de que cualquier `vi.mock(...)` tenga oportunidad de interceptarla.
 *
 * Cada test que necesita controlar el comportamiento del hook (
 * `PwaUpdateProvider.test.tsx`) hace su propio `vi.mock('virtual:pwa-register/react',
 * ...)` — este archivo es solo el módulo real al que apunta el alias, con
 * un resultado neutro (sin actualización pendiente) para cualquier test que
 * llegue a importar `PwaUpdateProvider` sin mockear nada.
 */
export function useRegisterSW() {
  return {
    needRefresh: [false, () => {}] as [boolean, (value: boolean) => void],
    offlineReady: [false, () => {}] as [boolean, (value: boolean) => void],
    updateServiceWorker: async () => {},
  }
}
