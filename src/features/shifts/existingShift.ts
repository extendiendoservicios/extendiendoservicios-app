import type { ConflictDetail } from '@/api/errors'
import type { ShiftDetail } from '@/api/assignments'
import { formatDateOnly } from '@/features/settings/dateOnly'
import { formatShiftRange } from '@/features/shifts/openEnded'

/**
 * OH-10: el turno que ya existe, para el aviso «Ya hay un turno» del alta.
 * Viene de dos lugares: del detalle de `SHIFT_DATE_TAKEN` (trae todo) o del
 * detalle del turno que se superpone (`shift_overlaps_in_site` solo da el id).
 * Sin React: se prueba aparte.
 */
export interface ExistingShiftInfo {
  shiftId: string
  clientName: string | null
  siteName: string | null
  shiftDate: string | null
  startTime: string | null
  endTime: string | null
  openEnded: boolean
  /** `null` = turno cargado a mano, sin servicio. */
  serviceName: string | null
  assigned: string[]
}

/** Ruta de edición del turno (ADM-07). */
export function editShiftPath(shiftId: string): string {
  return `/admin/turnos/${shiftId}/editar`
}

/** Desde el detalle de `SHIFT_DATE_TAKEN` (`ApiError.detail`); `null` si no trae el turno. */
export function existingShiftFromConflict(
  detail: ConflictDetail | null,
): ExistingShiftInfo | null {
  if (!detail?.conflictShiftId) {
    return null
  }
  return {
    shiftId: detail.conflictShiftId,
    clientName: detail.clientName,
    siteName: detail.siteName,
    shiftDate: detail.shiftDate,
    startTime: detail.startTime,
    endTime: detail.endTime,
    openEnded: detail.openEnded,
    serviceName: detail.serviceName,
    assigned: detail.assigned.map((person) => person.employeeName),
  }
}

/** Desde el detalle del turno de Planificación (se usa con las superposiciones de la sede). */
export function existingShiftFromDetail(
  detail: ShiftDetail,
): ExistingShiftInfo {
  return {
    shiftId: detail.id,
    clientName: detail.clientName,
    siteName: detail.siteName,
    shiftDate: detail.shiftDate,
    startTime: detail.startTime,
    endTime: detail.endTime,
    openEnded: detail.openEnded,
    serviceName: null,
    assigned: detail.assignments.map((person) =>
      `${person.employeeFirstName} ${person.employeeLastName}`.trim(),
    ),
  }
}

/** «Sin personas asignadas» o «Asignados: Ana Gómez, Luis Paz». */
export function assignedText(assigned: string[]): string {
  return assigned.length === 0
    ? 'Sin personas asignadas'
    : `${assigned.length === 1 ? 'Asignado' : 'Asignados'}: ${assigned.join(', ')}`
}

/** Fecha y horario en una línea: «jue 13 ago · 08:00–12:00». */
export function whenText(info: ExistingShiftInfo): string {
  const parts: string[] = []
  if (info.shiftDate) {
    parts.push(formatDateOnly(info.shiftDate))
  }
  if (info.startTime) {
    parts.push(formatShiftRange(info.startTime, info.endTime, info.openEnded))
  }
  return parts.join(' · ')
}

/** «Limpia Ya · Sede Centro»; con lo que falte omitido. */
export function whereText(info: ExistingShiftInfo): string {
  return [info.clientName, info.siteName].filter(Boolean).join(' · ')
}
