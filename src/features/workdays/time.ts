import {
  dateTimeLocalToIso,
  toDateTimeLocal,
} from '@/features/attendance/dateTimeLocal'

/**
 * Rango válido de las horas que corrige la administración en una jornada
 * (CJ-15 y CJ-32): dentro del día de la jornada (Argentina, ADR-019) y no
 * futuras, igual que `AT_OUT_OF_RANGE` en el servidor. Valores de
 * `input type="datetime-local"` (`yyyy-MM-ddTHH:mm`), que comparan bien
 * como texto.
 */
export function workdayTimeBounds(
  workDate: string,
  now: Date = new Date(),
): { min: string; max: string } {
  const dayStart = `${workDate}T00:00`
  const dayEnd = `${workDate}T23:59`
  const nowLocal = toDateTimeLocal(now)
  return { min: dayStart, max: nowLocal < dayEnd ? nowLocal : dayEnd }
}

/** `true` si la hora (`datetime-local`) cae dentro de los límites de `workdayTimeBounds`. */
export function isWithinWorkdayBounds(
  value: string,
  bounds: { min: string; max: string },
): boolean {
  return value >= bounds.min && value <= bounds.max
}

/**
 * Duración de una pausa para el detalle de la jornada. El servidor redondea
 * cada pausa al minuto más cercano (`app.workday_pauses`) y el total de
 * pausas sale de «bruto menos neto» (`pause_minutes`), así que una pausa de
 * menos de un minuto puede figurar como 0 min en el detalle y sumar 1 min en
 * el total. Para que se lea coherente, una pausa cerrada de menos de un
 * minuto se muestra como «menos de 1 min»; el resto muestra lo que da el
 * servidor.
 */
export function formatPauseDuration(
  pause: { startsAt: string; endsAt: string | null; minutes: number },
  format: (minutes: number) => string,
): string {
  if (pause.endsAt) {
    const ms = Date.parse(pause.endsAt) - Date.parse(pause.startsAt)
    if (Number.isFinite(ms) && ms < 60_000) return 'menos de 1 min'
  }
  return format(pause.minutes)
}

/**
 * Hora que se manda como `p_at` en «Finalizar jornada» y «Cerrar pausa»
 * (OD-06, OD-07): si quien la elige dejó la que venía por defecto (ahora, al
 * abrir el diálogo), no se manda y el servidor usa su propio «ahora»; si la
 * cambió, va como instante de Argentina.
 */
export function actionTimeToIso(
  value: string,
  initial: string,
): string | undefined {
  return value === initial ? undefined : dateTimeLocalToIso(value)
}

/**
 * Límites de la hora de una acción de la administración sobre una jornada:
 * desde `since` (el inicio de la jornada o de la pausa, si cae el mismo día) o
 * las 0:00 del día de la jornada, hasta ahora (nunca futura).
 */
export function actionTimeBounds(
  workDate: string,
  since: string | null,
  now: Date = new Date(),
): { min: string; max: string } {
  const bounds = workdayTimeBounds(workDate, now)
  if (since) {
    const sinceLocal = toDateTimeLocal(new Date(since))
    if (sinceLocal > bounds.min && sinceLocal <= bounds.max) {
      return { min: sinceLocal, max: bounds.max }
    }
  }
  return bounds
}
