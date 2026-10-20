import type { AttendanceBoardRow, PersonName } from '@/api/attendance'
import type { EmployeeLeave } from '@/api/employees'
import { formatCalendarDate } from '@/lib/format'
import { ABSENCE_REASON_LABELS } from '@/lib/absenceReasons'
import type { PrintColumn, PrintRowData } from '@/features/print/PrintTable'
import { formatShiftRange } from '@/features/shifts/openEnded'

/**
 * Imprimible «Licencias y ausencias» de la ficha del empleado (P19.11d):
 * lógica sin React que arma las dos tablas de la hoja. Las vacaciones no son
 * un tipo aparte: todo es licencia con motivo libre.
 *
 * Las ausencias salen de `v_assignments_board` (las filas con ausencia
 * avisada: `status = absence_notified` y último aviso de tipo ausencia, sea
 * del propio empleado o cargado por administración). No incluye las
 * inasistencias sin aviso.
 */

export const LEAVES_ABSENCES_TITLE = 'Licencias y ausencias'

export interface LeavesAbsencesPerson {
  name: string
  dni?: string | null
  employeeNumber: number
  /** Etiquetas de rol en español: «Empleado», «Supervisor». */
  roleLabels: string[]
  /** Etiqueta de quien firma por la persona. */
  signerLabel: string
}

export const LEAVES_ABSENCES_CONSENT_TEXT =
  'Las partes prestan conformidad con el detalle de licencias e inasistencias consignado.'

export interface LeavesAbsencesSheetModel {
  title: string
  documentTitle: string
  facts: { label: string; value: string }[]
  leaveColumns: PrintColumn[]
  leaveRows: PrintRowData[]
  leavesFooter: { label: string; value: string }
  absenceColumns: PrintColumn[]
  absenceRows: PrintRowData[]
  signers: string[]
  consentText: string
}

/** Primer día del año y último día del año de una fecha `"YYYY-MM-DD"`: período por omisión. */
export function currentYearRange(today: string): { from: string; to: string } {
  const year = today.slice(0, 4)
  return { from: `${year}-01-01`, to: `${year}-12-31` }
}

/** Diferencia en días entre dos fechas `"YYYY-MM-DD"` (sin pasar por la zona horaria). */
function dayNumber(isoDate: string): number {
  const [year = 0, month = 1, day = 1] = isoDate.split('-').map(Number)
  return Date.UTC(year, month - 1, day) / 86_400_000
}

/** `true` si la licencia toca el período. */
export function leaveOverlapsPeriod(
  leave: Pick<EmployeeLeave, 'startsOn' | 'endsOn'>,
  from: string,
  to: string,
): boolean {
  return leave.startsOn <= to && (leave.endsOn == null || leave.endsOn >= from)
}

/**
 * Días de la licencia dentro del período (extremos incluidos). Una licencia
 * abierta cuenta hasta hoy (o hasta el fin del período, lo que llegue
 * primero); si todavía no empezó, los días no se conocen (`null`).
 */
export function leaveDaysInPeriod(
  leave: Pick<EmployeeLeave, 'startsOn' | 'endsOn'>,
  from: string,
  to: string,
  today: string,
): number | null {
  if (!leaveOverlapsPeriod(leave, from, to)) {
    return 0
  }
  let end = leave.endsOn
  if (end == null) {
    if (leave.startsOn > today) {
      return null
    }
    end = today < to ? today : to
  }
  const clippedStart = leave.startsOn > from ? leave.startsOn : from
  const clippedEnd = end < to ? end : to
  if (clippedEnd < clippedStart) {
    return 0
  }
  return dayNumber(clippedEnd) - dayNumber(clippedStart) + 1
}

/** Texto de días: «5 días», «1 día». */
export function daysText(days: number): string {
  return days === 1 ? '1 día' : `${days} días`
}

/** Ausencias a turnos del empleado: avisadas, de turnos no cancelados y con asignación vigente. */
export function absenceRowsOf(
  rows: AttendanceBoardRow[],
): AttendanceBoardRow[] {
  return rows
    .filter(
      (row) =>
        row.status === 'absence_notified' &&
        row.lastNoticeKind === 'absence' &&
        row.shiftStatus !== 'cancelled' &&
        row.removedAt == null,
    )
    .sort(
      (a, b) =>
        a.shiftDate.localeCompare(b.shiftDate) ||
        a.startTime.localeCompare(b.startTime) ||
        a.id.localeCompare(b.id),
    )
}

/** Motivo de la ausencia: el de la lista, el texto libre, o ambos; «Sin motivo» si no hay. */
export function absenceReasonText(
  row: Pick<
    AttendanceBoardRow,
    'lastNoticeReasonCode' | 'lastNoticeReasonText'
  >,
): string {
  const text = row.lastNoticeReasonText?.trim()
  const code = row.lastNoticeReasonCode
  if (code === 'other') {
    return text || ABSENCE_REASON_LABELS.other
  }
  if (code) {
    return text
      ? `${ABSENCE_REASON_LABELS[code]}: ${text}`
      : ABSENCE_REASON_LABELS[code]
  }
  return text || 'Sin motivo'
}

export function certificateText(
  hasCertificate: boolean | null | undefined,
): string {
  if (hasCertificate === true) return 'Con certificado'
  if (hasCertificate === false) return 'Sin certificado'
  return 'Sin indicar'
}

/** Quién cargó el aviso: el propio empleado o el nombre de quien lo hizo en su nombre. */
export function absenceLoadedBy(
  row: Pick<AttendanceBoardRow, 'lastNoticeSource' | 'lastNoticeReportedBy'>,
  names: Map<string, PersonName>,
): string {
  if (row.lastNoticeSource !== 'admin') {
    return 'El propio empleado'
  }
  const person = row.lastNoticeReportedBy
    ? names.get(row.lastNoticeReportedBy)
    : undefined
  return person
    ? `${person.firstName} ${person.lastName} (administración)`
    : 'Administración'
}

export function buildLeavesAbsencesSheet(input: {
  person: LeavesAbsencesPerson
  from: string
  to: string
  leaves: EmployeeLeave[]
  attendance: AttendanceBoardRow[]
  names: Map<string, PersonName>
  /** Hoy en Buenos Aires (`"YYYY-MM-DD"`). */
  today: string
}): LeavesAbsencesSheetModel {
  const { person, from, to, today } = input

  const leaves = input.leaves
    .filter(
      (leave) =>
        leave.deletedAt == null && leaveOverlapsPeriod(leave, from, to),
    )
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn))
  const leaveRows: PrintRowData[] = leaves.map((leave) => {
    const days = leaveDaysInPeriod(leave, from, to, today)
    return {
      key: leave.id,
      from: formatCalendarDate(leave.startsOn),
      to: leave.endsOn ? formatCalendarDate(leave.endsOn) : 'Abierta',
      reason: leave.reason?.trim() || '—',
      days: days == null ? '—' : daysText(days),
    }
  })
  const totalLeaveDays = leaves.reduce(
    (total, leave) => total + (leaveDaysInPeriod(leave, from, to, today) ?? 0),
    0,
  )

  const absences = absenceRowsOf(input.attendance)
  const absenceRows: PrintRowData[] = absences.map((row) => ({
    key: row.id,
    date: formatCalendarDate(row.shiftDate),
    client: row.clientName,
    site: row.siteName,
    schedule: formatShiftRange(row.startTime, row.endTime, row.openEnded),
    reason: absenceReasonText(row),
    certificate: certificateText(row.lastNoticeHasCertificate),
    loadedBy: absenceLoadedBy(row, input.names),
  }))
  const withCertificate = absences.filter(
    (row) => row.lastNoticeHasCertificate === true,
  ).length
  const withoutCertificate = absences.filter(
    (row) => row.lastNoticeHasCertificate === false,
  ).length
  const unspecified = absences.length - withCertificate - withoutCertificate

  return {
    title: LEAVES_ABSENCES_TITLE,
    documentTitle: `${LEAVES_ABSENCES_TITLE} - ${person.name} - ${from} al ${to}`,
    facts: [
      { label: 'Nombre y Apellido', value: person.name },
      { label: 'DNI', value: person.dni || '—' },
      { label: 'Legajo', value: String(person.employeeNumber) },
      { label: 'Rol', value: person.roleLabels.join(', ') || '—' },
      {
        label: 'Período',
        value: `${formatCalendarDate(from)} al ${formatCalendarDate(to)}`,
      },
      {
        label: 'Licencias',
        value: `${leaves.length} (${daysText(totalLeaveDays)})`,
      },
      {
        label: 'Ausencias a turnos',
        value:
          absences.length === 0
            ? '0'
            : `${absences.length} (${withCertificate} con certificado, ${withoutCertificate} sin certificado, ${unspecified} sin indicar)`,
      },
    ],
    leaveColumns: [
      { key: 'from', header: 'Desde' },
      { key: 'to', header: 'Hasta' },
      { key: 'reason', header: 'Motivo' },
      { key: 'days', header: 'Días', align: 'right' },
    ],
    leaveRows,
    leavesFooter: {
      label: 'Total de días de licencia en el período',
      value: daysText(totalLeaveDays),
    },
    absenceColumns: [
      { key: 'date', header: 'Fecha' },
      { key: 'client', header: 'Cliente' },
      { key: 'site', header: 'Sede' },
      { key: 'schedule', header: 'Horario' },
      { key: 'reason', header: 'Motivo' },
      { key: 'certificate', header: 'Certificado' },
      { key: 'loadedBy', header: 'Lo cargó' },
    ],
    absenceRows,
    signers: ['Responsable (administración)', person.signerLabel],
    consentText: LEAVES_ABSENCES_CONSENT_TEXT,
  }
}
