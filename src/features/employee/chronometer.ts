/**
 * `src/features/employee/chronometer.ts` (MOB-EMP-008, EMP-07 servicio en
 * curso): el cronómetro se calcula siempre a partir de `check_in_at`, la
 * hora que puso el servidor al registrar el inicio (`06` sección 10,
 * `record_check_in`) — nunca a partir de un contador propio que arranque de
 * cero en el celular. La app solo resta "ahora" (el reloj del dispositivo)
 * menos ese instante fijo: un pequeño desvío del reloj del celular corre por
 * igual a los dos lados de la resta y no afecta el cronómetro visible
 * (decisión menor: no hace falta pedirle la hora al servidor en cada
 * segundo para que el cronómetro sea correcto).
 */

/** Segundos transcurridos desde `checkInAt` hasta `now`, nunca negativos. */
export function elapsedSeconds(checkInAt: string, now: Date): number {
  const start = new Date(checkInAt).getTime()
  const diffMs = now.getTime() - start
  return Math.max(0, Math.floor(diffMs / 1000))
}

/**
 * Formato de cronómetro: `"MM:SS"` mientras dura menos de una hora,
 * `"H:MM:SS"` a partir de la primera hora (sin cero a la izquierda en las
 * horas, como cualquier cronómetro de celular).
 */
export function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.trunc(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60

  const mm = String(minutes).padStart(2, '0')
  const ss = String(remainingSeconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}
