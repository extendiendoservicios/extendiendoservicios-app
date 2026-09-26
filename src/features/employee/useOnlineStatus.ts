import { useSyncExternalStore } from 'react'

/**
 * `useOnlineStatus` (regla común de esta capa, `08_Fases_y_Backlog.md`:
 * "banner simple si `navigator.onLine` es falso y los botones que llaman
 * RPC se deshabilitan"). Mismo patrón que `useMediaQuery`
 * (`src/hooks/useMediaQuery.ts`, DS-008): `useSyncExternalStore` sobre los
 * eventos `online`/`offline` de `window`, sin un `useState` + `useEffect`
 * propio.
 *
 * Vive acá (no en `src/hooks/`, que no es mío en este encargo) porque hoy
 * solo lo usa EMP-06 (el botón "Aceptar y continuar" hace un `update` de
 * `profiles`, que tampoco tiene sentido intentar sin conexión). Si otra vía
 * lo necesita después, conviene subirlo a `src/hooks/` — pedido a
 * front-plataforma, mismo criterio que anota `src/api/README.md` para
 * `UpdatedAgo.tsx`.
 */
function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
}
