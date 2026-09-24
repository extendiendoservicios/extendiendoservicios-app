import { useEffect, useState } from 'react'

/**
 * Devuelve `value`, pero recién `delayMs` después de que dejó de cambiar
 * (CLIENT-002, filtro de texto de ADM-19): evita mandar una consulta a
 * `v_clients` en cada tecla. Local a `features/clients` porque, a
 * diferencia de `useMediaQuery` (`src/hooks/`, lo usa `DataTable` en toda la
 * app), hoy es el único filtro de texto del repo — mismo criterio que
 * `UpdatedAgo` en `src/api/README.md` sección 5: si un segundo dominio lo
 * necesita, conviene subirlo a `src/hooks/` (pedido a front-plataforma).
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timeoutId = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timeoutId)
  }, [value, delayMs])

  return debounced
}
