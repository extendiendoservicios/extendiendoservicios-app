import { useEffect, useState } from 'react'

/**
 * Devuelve `value`, pero recién `delayMs` después de que dejó de cambiar
 * (CLIENT-002, filtro de texto de ADM-19): evita mandar una consulta en
 * cada tecla. Compartido en `src/hooks/` (junto con `useMediaQuery`) desde
 * P09.2 (EMP-012, `GlobalSearch`): dejó de ser un filtro exclusivo de
 * `features/clients` en cuanto un segundo dominio lo necesitó, tal como
 * anticipaba el comentario original de este archivo.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timeoutId = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timeoutId)
  }, [value, delayMs])

  return debounced
}
