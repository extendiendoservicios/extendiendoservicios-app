import type { AttendanceBoardRow } from '@/api/attendance'
import type { SupervisionListRow } from '@/api/supervisions'
import type { EmployeeLeave } from '@/api/employees'
import type { Role } from '@/api/users'
import { ROLE_LABELS } from '@/features/auth/session'
import {
  absenceReasonText,
  leaveOverlapsPeriod,
} from '@/features/employees/leavesAbsencesSheet'
import { formatCalendarDate, formatMinutes, formatTime } from '@/lib/format'
import type { PrintColumn, PrintRowData } from '@/features/print/PrintTable'
import { formatShiftRange } from '@/features/shifts/openEnded'
import { absenceDetail, isAbsence } from '@/features/attendance/absences'
import { joinObservations } from '@/features/shifts/observation'
import { geoPrintText } from '@/features/geo/printText'

/**
 * Detalle de asistencia de una persona (AJ-06): lógica sin React que arma las
 * filas de la pestaña «Asistencia» de la ficha y la hoja imprimible.
 *
 * Una persona con doble rol (supervisor y empleado) tiene dos fuentes de
 * horas: sus servicios (`v_assignments_board`) y sus supervisiones
 * (`v_supervisions_admin`). Se muestran juntas, ordenadas por fecha, con una
 * columna «Tipo» (Servicio / Supervisión), y el total del período las suma.
 */

export type AttendanceDetailEntry =
  | {
      kind: 'service'
      key: string
      date: string
      startTime: string
      row: AttendanceBoardRow
    }
  | {
      kind: 'supervision'
      key: string
      date: string
      startTime: string
      row: SupervisionListRow
    }

/** Une servicios y supervisiones, de la fecha más reciente a la más antigua. */
export function buildAttendanceEntries(
  services: AttendanceBoardRow[],
  supervisions: SupervisionListRow[],
): AttendanceDetailEntry[] {
  const entries: AttendanceDetailEntry[] = [
    ...services.map((row): AttendanceDetailEntry => ({
      kind: 'service',
      key: `service-${row.id}`,
      date: row.shiftDate,
      startTime: row.startTime,
      row,
    })),
    ...supervisions.map((row): AttendanceDetailEntry => ({
      kind: 'supervision',
      key: `supervision-${row.id}`,
      date: row.shiftDate,
      startTime: row.startTime,
      row,
    })),
  ]
  return entries.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      b.startTime.localeCompare(a.startTime) ||
      a.key.localeCompare(b.key),
  )
}

export function entryWorkedMinutes(
  entry: AttendanceDetailEntry,
): number | null {
  return entry.row.workedMinutes
}

export function entryCheckIn(entry: AttendanceDetailEntry): string | null {
  return entry.row.checkInAt
}

export function entryCheckOut(entry: AttendanceDetailEntry): string | null {
  return entry.row.checkOutAt
}

/**
 * Total de horas del período, en minutos: suma los minutos trabajados de
 * todas las filas (los turnos sin fin registrado no suman).
 */
export function sumWorkedMinutes(entries: AttendanceDetailEntry[]): number {
  return entries.reduce(
    (total, entry) => total + (entryWorkedMinutes(entry) ?? 0),
    0,
  )
}

/** Franja `08:00–12:00` de la fila (`08:00–A terminar` en un turno abierto). */
export function entryFranja(entry: AttendanceDetailEntry): string {
  return formatShiftRange(
    entry.row.startTime,
    entry.row.endTime,
    entry.kind === 'service' ? entry.row.openEnded : entry.row.shiftOpenEnded,
  )
}

export const ENTRY_KIND_LABELS = {
  service: 'Servicio',
  supervision: 'Supervisión',
} as const

// -------------------------------------------------------------------------
// Hoja imprimible
// -------------------------------------------------------------------------

export interface AttendanceSheetPerson {
  name: string
  /** DNI de la persona (AJ2-16); si no viene, la hoja lo muestra como «—». */
  dni?: string | null
  employeeNumber: number
  /** Etiquetas de rol en español: «Empleado», «Supervisor». */
  roleLabels: string[]
  /** Etiqueta de quien firma por la persona. */
  signerLabel: string
}

export interface AttendanceSheetModel {
  title: string
  facts: { label: string; value: string }[]
  columns: PrintColumn[]
  rows: PrintRowData[]
  footer: { label: string; value: string }
  totalMinutes: number
  signers: string[]
  consentText: string
  documentTitle: string
}

export const ATTENDANCE_SHEET_TITLE = 'Detalle de asistencia'
export const ATTENDANCE_CONSENT_TEXT =
  'Las partes prestan conformidad con el detalle de horas consignado.'

/** Quién firma por la persona, según sus roles. */
export function personSignerLabel(roleLabels: string[]): string {
  return roleLabels.length > 0
    ? roleLabels
        .join(' y ')
        .toLowerCase()
        .replace(/^./, (c) => c.toUpperCase())
    : 'Persona'
}

/** Etiquetas de rol para el imprimible (solo empleado y supervisor). */
export function printRoleLabels(roles: Role[]): string[] {
  return roles
    .filter((role) => role === 'employee' || role === 'supervisor')
    .map((role) => ROLE_LABELS[role])
}

/** «dd/mm/aaaa» de una fecha `"YYYY-MM-DD"`. */
function numericDate(isoDate: string): string {
  const [year = '', month = '', day = ''] = isoDate.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

/**
 * Novedad de una inasistencia. Si fue avisada como ausencia:
 * «Inasistencia — con certificado — Enfermedad». Si no tuvo aviso queda el
 * texto de siempre («Inasistencia: sin fichaje de inicio»).
 */
export function absenceSheetNote(row: AttendanceBoardRow): string {
  if (row.status === 'absence_notified' && row.lastNoticeKind === 'absence') {
    const certificate =
      row.lastNoticeHasCertificate === true
        ? 'con certificado'
        : row.lastNoticeHasCertificate === false
          ? 'sin certificado'
          : 'certificado sin indicar'
    return `Inasistencia — ${certificate} — ${absenceReasonText(row)}`
  }
  return absenceDetail(row)
}

/**
 * Texto de una licencia dentro de la tabla: «Licencia del 02/03/2026 al
 * 06/03/2026 — Vacaciones» (o «abierta» si no tiene fin).
 */
export function leaveSheetNote(
  leave: Pick<EmployeeLeave, 'startsOn' | 'endsOn' | 'reason'>,
): string {
  const until = leave.endsOn ? numericDate(leave.endsOn) : 'abierta'
  return `Licencia del ${numericDate(leave.startsOn)} al ${until} — ${leave.reason?.trim() || 'Sin motivo'}`
}

/**
 * Es una inasistencia (AJ2-14): servicio sin fichaje de inicio, con aviso de
 * ausencia o con la franja ya terminada (ver `isAbsence`). Las supervisiones
 * no se tratan acá.
 */
export function isAbsenceEntry(
  entry: AttendanceDetailEntry,
  now: Date,
): boolean {
  return entry.kind === 'service' && isAbsence(entry.row, now)
}

/**
 * Qué filas entran en la hoja: las que tienen un inicio registrado (trabajo
 * efectivo o en curso) y, desde AJ2-14, las inasistencias (turnos asignados
 * sin inicio cuya franja terminó, o con aviso de ausencia). Quedan afuera los
 * turnos cancelados, las asignaciones quitadas y los turnos que todavía no
 * empezaron.
 */
export function printableEntries(
  entries: AttendanceDetailEntry[],
  now: Date = new Date(),
): AttendanceDetailEntry[] {
  return entries.filter(
    (entry) => entryCheckIn(entry) != null || isAbsenceEntry(entry, now),
  )
}

function formatPeriodDate(isoDate: string): string {
  return formatCalendarDate(isoDate)
}

/**
 * Arma el contenido de la hoja «Detalle de asistencia»: datos de la persona,
 * período, tabla en orden cronológico, total y los dos espacios de firma.
 */
export function buildAttendanceSheet(input: {
  person: AttendanceSheetPerson
  from: string
  to: string
  entries: AttendanceDetailEntry[]
  /** Licencias de la persona: las del período se intercalan en la tabla, sin horas. */
  leaves?: EmployeeLeave[]
  /** Inyectable para tests; por defecto el momento de armar la hoja. */
  now?: Date
}): AttendanceSheetModel {
  const now = input.now ?? new Date()
  const lines = printableEntries(input.entries, now)
  const leaves = (input.leaves ?? []).filter(
    (leave) =>
      leave.deletedAt == null &&
      leaveOverlapsPeriod(leave, input.from, input.to),
  )
  // Cada fila de la tabla (turno o licencia) con su clave de orden: fecha y
  // hora de inicio. Una licencia va en su fecha de inicio (o al comienzo del
  // período si empezó antes) y antes de los turnos de ese día.
  type Line =
    | {
        type: 'entry'
        date: string
        sortTime: string
        entry: AttendanceDetailEntry
      }
    | { type: 'leave'; date: string; sortTime: string; leave: EmployeeLeave }
  const allLines: Line[] = [
    ...lines.map((entry): Line => ({
      type: 'entry',
      date: entry.date,
      sortTime: entry.startTime,
      entry,
    })),
    ...leaves.map((leave): Line => ({
      type: 'leave',
      date: leave.startsOn > input.from ? leave.startsOn : input.from,
      sortTime: '',
      leave,
    })),
  ].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.sortTime.localeCompare(b.sortTime) ||
      (a.type === 'leave' ? a.leave.id : a.entry.key).localeCompare(
        b.type === 'leave' ? b.leave.id : b.entry.key,
      ),
  )
  const hasSupervisions = lines.some((entry) => entry.kind === 'supervision')
  const totalMinutes = sumWorkedMinutes(lines)
  const absencesCount = lines.filter((entry) =>
    isAbsenceEntry(entry, now),
  ).length

  const columns: PrintColumn[] = [
    { key: 'date', header: 'Fecha' },
    ...(hasSupervisions ? [{ key: 'kind', header: 'Tipo' }] : []),
    { key: 'client', header: 'Cliente' },
    { key: 'site', header: 'Sede' },
    { key: 'franja', header: 'Franja' },
    { key: 'start', header: 'Inicio' },
    { key: 'end', header: 'Fin' },
    // B1 (B-20): validación por ubicación, solo el resultado, sin coordenadas.
    { key: 'geo', header: 'Validación' },
    { key: 'novelty', header: 'Observaciones' },
    { key: 'hours', header: 'Horas', align: 'right' },
  ]

  const rows: PrintRowData[] = allLines.map((line) => {
    if (line.type === 'leave') {
      return {
        key: `leave-${line.leave.id}`,
        date: formatPeriodDate(line.date),
        kind: 'Licencia',
        client: '—',
        site: '—',
        franja: '—',
        start: '—',
        end: '—',
        geo: '',
        novelty: leaveSheetNote(line.leave),
        hours: '—',
      }
    }
    const entry = line.entry
    const checkIn = entryCheckIn(entry)
    const checkOut = entryCheckOut(entry)
    const worked = entryWorkedMinutes(entry)
    const absent = isAbsenceEntry(entry, now)
    return {
      key: entry.key,
      date: formatPeriodDate(entry.date),
      kind: ENTRY_KIND_LABELS[entry.kind],
      client: entry.row.clientName,
      site: entry.row.siteName,
      franja: entryFranja(entry),
      start: checkIn ? formatTime(checkIn) : '—',
      end: checkOut ? formatTime(checkOut) : '—',
      geo: geoPrintText(entry.row.checkInGeo, entry.row.checkOutGeo),
      // AJ2-15: la observación del turno (si tiene tildado «mostrar en la impresión») va junto a la novedad.
      novelty:
        entry.kind === 'service'
          ? joinObservations(
              absent ? absenceSheetNote(entry.row) : '',
              entry.row.shiftObservation,
            )
          : '',
      hours: worked != null ? formatMinutes(worked) : '—',
    }
  })

  const fullPeriod = `${formatPeriodDate(input.from)} al ${formatPeriodDate(input.to)}`
  return {
    title: ATTENDANCE_SHEET_TITLE,
    facts: [
      { label: 'Nombre y Apellido', value: input.person.name },
      { label: 'DNI', value: input.person.dni || '—' },
      { label: 'Legajo', value: String(input.person.employeeNumber) },
      { label: 'Rol', value: input.person.roleLabels.join(', ') || '—' },
      { label: 'Período', value: fullPeriod },
      ...(absencesCount > 0
        ? [{ label: 'Inasistencias', value: String(absencesCount) }]
        : []),
      ...(leaves.length > 0
        ? [{ label: 'Licencias', value: String(leaves.length) }]
        : []),
    ],
    columns,
    rows,
    footer: {
      label: 'Total del período',
      value: formatMinutes(totalMinutes),
    },
    totalMinutes,
    signers: ['Responsable (administración)', input.person.signerLabel],
    consentText: ATTENDANCE_CONSENT_TEXT,
    documentTitle: `Detalle de asistencia - ${input.person.name} - ${input.from} al ${input.to}`,
  }
}
