import { useEffect, useState } from 'react'

/**
 * `useNow` (MOB-EMP-007, MOB-EMP-008, MOB-EMP-011): un reloj que se
 * actualiza solo cada `intervalMs`, para la hora de referencia de EMP-05 y
 * EMP-10 y el cronómetro de EMP-07 (`src/features/employee/chronometer.ts`).
 * Nunca es la hora que queda guardada — eso lo pone el servidor dentro de
 * cada RPC (`06_API.md` sección 10, P-066) — solo lo que la pantalla puede
 * mostrar mientras tanto.
 */
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return now
}
