/**
 * OF-22: en las hojas imprimibles, la hora de fin de un cierre automático
 * (el fin lo puso el sistema, nadie lo fichó) lleva «*» y la hoja agrega al
 * pie esta nota, solo si hay al menos un caso.
 */
export const AUTO_CLOSED_STAR = '*'
export const AUTO_CLOSED_NOTE = '* Cierre automático: no se registró el fin.'

/** Agrega el «*» al texto si el cierre fue automático. */
export function withAutoClosedStar(text: string, autoClosed: boolean): string {
  return autoClosed ? `${text}${AUTO_CLOSED_STAR}` : text
}
