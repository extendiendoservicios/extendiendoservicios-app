/** Separador de las partes de la columna «Observaciones» de los imprimibles. */
export const OBSERVATION_SEPARATOR = ' · '

/**
 * AJ2-15: une las partes de la columna «Observaciones» de una hoja impresa
 * (inasistencia, «Sin salida», observación del turno). Ignora las vacías.
 */
export function joinObservations(
  ...parts: (string | null | undefined)[]
): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(OBSERVATION_SEPARATOR)
}
