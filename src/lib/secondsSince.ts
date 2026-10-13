/**
 * Segundos transcurridos desde `timestampMs` hasta `nowMs` para el indicador
 * "Actualizado hace n s". Devuelve `null` si no hay una marca válida
 * (TanStack Query informa `dataUpdatedAt = 0` mientras no hay datos o durante
 * un refetch sin datos previos): en ese caso no se muestra el texto.
 */
export function secondsSince(
  nowMs: number,
  timestampMs: number | null | undefined,
): number | null {
  if (
    typeof timestampMs !== 'number' ||
    !Number.isFinite(timestampMs) ||
    timestampMs <= 0
  ) {
    return null
  }
  return Math.max(0, Math.round((nowMs - timestampMs) / 1000))
}
