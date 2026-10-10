/**
 * AJ2-10 (migración 0037): turnos y servicios «A terminar». La base guarda el fin en 23:59 y la
 * marca `open_ended`; en pantalla el fin se muestra como «A terminar», nunca como 23:59.
 */

export const OPEN_ENDED_LABEL = 'A terminar'

/** AJ2-09: asignación de un turno «A terminar» que pasó el día sin fichaje de salida. */
export const NO_CHECKOUT_LABEL = 'Sin salida'

/** `"08:00:00"`, `"12:00:00"` → `"08:00–12:00"`; con `openEnded` → `"08:00–A terminar"`. */
export function formatShiftRange(
  startTime: string,
  endTime: string | null | undefined,
  openEnded: boolean | null | undefined,
): string {
  const start = startTime.slice(0, 5)
  if (openEnded || !endTime) return `${start}–${OPEN_ENDED_LABEL}`
  return `${start}–${endTime.slice(0, 5)}`
}
