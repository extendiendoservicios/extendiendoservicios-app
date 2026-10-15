import { formatGeoStatusText } from '@/lib/geo'
import type { BoardAttendanceGeo } from '@/api/attendance'

/** Lo mínimo de una validación para el texto: también sirve la del resumen por cliente (`ClientSummaryGeo`). */
export type PrintableGeo = Pick<
  BoardAttendanceGeo,
  'status' | 'reason' | 'distanceM' | 'overridden'
>

function textOf(geo: PrintableGeo): string {
  return formatGeoStatusText({
    status: geo.status,
    reason: geo.reason,
    distanceM: geo.distanceM,
    corrected: geo.overridden,
  })
}

/**
 * Texto de la validación para los imprimibles (B-20): «Validado», «Fuera de
 * zona (350 m)» o «Sin validar», sin coordenadas. Si inicio y fin dieron lo
 * mismo se escribe una sola vez; si no, «Inicio: … · Fin: …». Sin fichaje, un
 * guion largo.
 */
export function geoPrintText(
  checkIn: PrintableGeo | null | undefined,
  checkOut: PrintableGeo | null | undefined,
): string {
  if (!checkIn && !checkOut) {
    return '—'
  }
  if (checkIn && !checkOut) {
    return textOf(checkIn)
  }
  if (!checkIn && checkOut) {
    return `Fin: ${textOf(checkOut)}`
  }
  const start = textOf(checkIn as PrintableGeo)
  const end = textOf(checkOut as PrintableGeo)
  return start === end ? start : `Inicio: ${start} · Fin: ${end}`
}
