import { formatGeoStatusText } from '@/lib/geo'
import type { BoardAttendanceGeo } from '@/api/attendance'

function textOf(geo: BoardAttendanceGeo): string {
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
  checkIn: BoardAttendanceGeo | null | undefined,
  checkOut: BoardAttendanceGeo | null | undefined,
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
  const start = textOf(checkIn as BoardAttendanceGeo)
  const end = textOf(checkOut as BoardAttendanceGeo)
  return start === end ? start : `Inicio: ${start} · Fin: ${end}`
}
