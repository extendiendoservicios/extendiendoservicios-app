import { useSyncExternalStore } from 'react'

/**
 * `useMediaQuery` (DS-008): hook mínimo sobre `window.matchMedia`, usado por
 * `DataTable` para decidir entre la tabla y la lista de `RowCard` en el
 * quiebre de 1024 px (`05_Pantallas_y_Navegacion.md` sección 7).
 *
 * `useSyncExternalStore` evita el parpadeo de un `useState` + `useEffect`
 * (nada que renderice de más en el primer render) y reacciona sola a los
 * cambios de tamaño de la ventana sin un listener de `resize` a mano.
 *
 * La app es una SPA sin SSR (ADR-021: React Router 7 "en modo biblioteca"),
 * así que el snapshot del servidor (`false`) nunca se usa en producción —
 * solo hace falta para que `useSyncExternalStore` tenga qué devolver si
 * algo la invoca fuera del navegador (p. ej. en un test sin `matchMedia`).
 */
function subscribe(query: string, onChange: () => void) {
  const mediaQueryList = window.matchMedia(query)
  mediaQueryList.addEventListener('change', onChange)
  return () => mediaQueryList.removeEventListener('change', onChange)
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => subscribe(query, onChange),
    () => window.matchMedia(query).matches,
    () => false,
  )
}
