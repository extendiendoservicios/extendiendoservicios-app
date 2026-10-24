import type { AttendanceBoardRow } from '@/api/attendance'
import type { EmployeeLeave } from '@/api/employees'
import type { Role } from '@/api/users'
import { ROLE_LABELS } from '@/features/auth/session'
import {
  absenceReasonText,
  leaveOverlapsPeriod,
} from '@/features/employees/leavesAbsencesSheet'
import { formatCalendarDate, formatMinutes, formatTime } from '@/lib/format'
import type {
  PrintColumn,
  PrintRowData,
  PrintRowSpan,
} from '@/features/print/PrintTable'
import { formatShiftRange } from '@/features/shifts/openEnded'
import { absenceDetail, isAbsence } from '@/features/attendance/absences'
import { joinObservations } from '@/features/shifts/observation'
import { geoPrintText } from '@/features/geo/printText'
import type { AdminWorkday } from '@/api/workdaysAdmin'

/**
 * Detalle de asistencia de una persona (AJ-06, P24.4): lógica sin React que
 * arma las filas de la pestaña «Asistencia» de la ficha y la hoja imprimible.
 *
 * Las horas de un empleado son las de sus servicios (`v_assignments_board`).
 * Las de un coordinador son las de su jornada (`v_supervisor_workdays_admin`,
 * CJ-13): inicio a fin menos las pausas. El tiempo de cada supervisión es
 * informativo y no suma (CJ-14). Una persona con los dos roles tiene dos
 * secciones en la hoja, cada una con su total, y la suma al final (CJ-34).
 */

export interface AttendanceDetailEntry {
  kind: 'service'
  key: string
  date: string
  startTime: string
  row: AttendanceBoardRow
}

/** Ordena los servicios de la fecha más reciente a la más antigua. */
export function buildAttendanceEntries(
  services: AttendanceBoardRow[],
): AttendanceDetailEntry[] {
  const entries = services.map((row): AttendanceDetailEntry => ({
    kind: 'service',
    key: `service-${row.id}`,
    date: row.shiftDate,
    startTime: row.startTime,
    row,
  }))
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
    entry.row.openEnded,
  )
}

/** Total de horas de las jornadas del período, en minutos (CJ-13, CJ-18). */
export function sumWorkdayMinutes(workdays: AdminWorkday[]): number {
  return workdays.reduce((total, workday) => total + workday.workedMinutes, 0)
}

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

/** Una tabla de la hoja: los turnos como empleado o las jornadas como coordinador. */
export interface AttendanceSheetSection {
  key: 'services' | 'workdays'
  /** Título de la sección; solo cuando la hoja lleva las dos (CJ-34). */
  heading?: string
  columns: PrintColumn[]
  rows: PrintRowData[]
  /** Filas con celda unida (las licencias y las supervisiones). */
  spans: Record<string, PrintRowSpan>
  footer: { label: string; value: string }
  emptyText: string
  totalMinutes: number
}

export interface AttendanceSheetModel {
  title: string
  facts: { label: string; value: string }[]
  sections: AttendanceSheetSection[]
  /** Suma de las secciones, solo cuando hay más de una (CJ-34). */
  grandTotal?: { label: string; value: string }
  totalMinutes: number
  signers: string[]
  consentText: string
  documentTitle: string
}

export const ATTENDANCE_SHEET_TITLE = 'Detalle de asistencia'
export const WORKDAYS_SHEET_TITLE = 'Detalle de jornadas'
export const ATTENDANCE_AND_WORKDAYS_TITLE = 'Detalle de asistencia y jornadas'
// Texto único (con o sin licencias e inasistencias): la hoja las puede incluir.
export const ATTENDANCE_CONSENT_TEXT =
  'Las partes prestan conformidad con el detalle de horas, licencias e inasistencias consignado.'

export const WORKDAYS_CONSENT_TEXT =
  'Las partes prestan conformidad con el detalle de jornadas y horas consignado.'

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

// -------------------------------------------------------------------------
// Jornadas del coordinador (P24.4, CJ-19, CJ-34)
// -------------------------------------------------------------------------

export const WORKDAYS_SECTION_HEADING = 'Jornadas como coordinador'
export const SERVICES_SECTION_HEADING = 'Turnos como empleado'
export const AUTO_CLOSED_MARK = 'Cerrada automáticamente'
export const CORRECTED_MARK = 'Corregida'

/** Texto de las pausas de una jornada: «12:00 a 12:35 (35 min) — motivo». */
export function workdayPausesText(workday: AdminWorkday): string {
  if (workday.pauses.length === 0) {
    return '—'
  }
  return workday.pauses
    .map((pause) => {
      const range = pause.endsAt
        ? `${formatTime(pause.startsAt)} a ${formatTime(pause.endsAt)} (${formatMinutes(pause.minutes)})`
        : `desde ${formatTime(pause.startsAt)}`
      return pause.reason ? `${range} — ${pause.reason}` : range
    })
    .join('; ')
}

/** Marcas de la jornada: «Cerrada automáticamente» (CJ-31) y «Corregida» (CJ-32). */
export function workdayMarks(workday: AdminWorkday): string {
  return [
    workday.autoClosed ? AUTO_CLOSED_MARK : '',
    workday.corrected ? CORRECTED_MARK : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Renglón de una supervisión: cliente, sede, inicio a fin y duración informativa (CJ-14). */
export function workdaySupervisionText(
  supervision: AdminWorkday['supervisions'][number],
): string {
  const where = [supervision.clientName, supervision.siteName]
    .filter(Boolean)
    .join(' · ')
  const range = supervision.checkInAt
    ? supervision.checkOutAt
      ? `${formatTime(supervision.checkInAt)} a ${formatTime(supervision.checkOutAt)}`
      : `desde ${formatTime(supervision.checkInAt)}`
    : 'sin horario'
  const duration =
    supervision.durationMinutes != null
      ? `${formatMinutes(supervision.durationMinutes)}, informativo`
      : 'informativo'
  const unclosed = supervision.unclosed ? ' — Sin cerrar' : ''
  return `Supervisión: ${where}, ${range} (${duration})${unclosed}`
}

const WORKDAY_COLUMNS: PrintColumn[] = [
  { key: 'date', header: 'Fecha' },
  { key: 'start', header: 'Inicio' },
  { key: 'end', header: 'Fin' },
  { key: 'pauses', header: 'Pausas', wrap: true },
  { key: 'notes', header: 'Observaciones', wrap: true },
  { key: 'hours', header: 'Horas netas', align: 'right' },
]

/** Sección de jornadas: una fila por día y, debajo, sus supervisiones. */
export function buildWorkdaysSection(
  workdays: AdminWorkday[],
  footerLabel: string,
  heading?: string,
): AttendanceSheetSection {
  const spans: Record<string, PrintRowSpan> = {}
  const rows: PrintRowData[] = []
  for (const workday of [...workdays].sort(
    (a, b) =>
      a.workDate.localeCompare(b.workDate) ||
      a.startedAt.localeCompare(b.startedAt),
  )) {
    rows.push({
      key: `workday-${workday.id}`,
      date: formatCalendarDate(workday.workDate),
      start: formatTime(workday.startedAt),
      end: workday.endedAt ? formatTime(workday.endedAt) : 'En curso',
      pauses: workdayPausesText(workday),
      notes: workdayMarks(workday),
      hours: formatMinutes(workday.workedMinutes),
    })
    for (const supervision of workday.supervisions) {
      const key = `supervision-${supervision.supervisionId}`
      // Cliente, sede, horario y duración van en una celda unida (Inicio → Observaciones).
      spans[key] = { from: 'start', to: 'notes' }
      rows.push({
        key,
        date: '',
        start: workdaySupervisionText(supervision),
        end: '',
        pauses: '',
        notes: '',
        hours: '',
      })
    }
  }
  const totalMinutes = sumWorkdayMinutes(workdays)
  return {
    key: 'workdays',
    heading,
    columns: WORKDAY_COLUMNS,
    rows,
    spans,
    footer: { label: footerLabel, value: formatMinutes(totalMinutes) },
    emptyText: 'No hay jornadas registradas en este período.',
    totalMinutes,
  }
}

/**
 * Arma el contenido de la hoja de asistencia: datos de la persona, período,
 * las tablas (turnos como empleado y/o jornadas como coordinador), totales y
 * los dos espacios de firma. Con las dos secciones, cada una lleva su total y
 * al final va la suma (CJ-34).
 */
export function buildAttendanceSheet(input: {
  person: AttendanceSheetPerson
  from: string
  to: string
  entries: AttendanceDetailEntry[]
  /** Licencias de la persona: las del período se intercalan en la tabla, sin horas. */
  leaves?: EmployeeLeave[]
  /**
   * Jornadas del período de un coordinador (CJ-19). Si viene (aunque vacío),
   * la hoja lleva la sección de jornadas.
   */
  workdays?: AdminWorkday[]
  /** Si lleva la sección de turnos como empleado. Por omisión, sí. */
  includeServices?: boolean
  /** Inyectable para tests; por defecto el momento de armar la hoja. */
  now?: Date
}): AttendanceSheetModel {
  const includeServices = input.includeServices ?? true
  const hasWorkdays = input.workdays != null
  const both = includeServices && hasWorkdays
  const sections: AttendanceSheetSection[] = []
  let absencesCount = 0
  let leavesCount = 0

  if (includeServices) {
    const services = buildServicesSection(input, both)
    sections.push(services.section)
    absencesCount = services.absencesCount
    leavesCount = services.leavesCount
  }
  if (input.workdays) {
    sections.push(
      buildWorkdaysSection(
        input.workdays,
        both ? 'Total como coordinador' : 'Total del período',
        both ? WORKDAYS_SECTION_HEADING : undefined,
      ),
    )
  }

  const totalMinutes = sections.reduce(
    (total, section) => total + section.totalMinutes,
    0,
  )
  const title = both
    ? ATTENDANCE_AND_WORKDAYS_TITLE
    : includeServices
      ? ATTENDANCE_SHEET_TITLE
      : WORKDAYS_SHEET_TITLE
  const fullPeriod = `${formatPeriodDate(input.from)} al ${formatPeriodDate(input.to)}`
  return {
    title,
    facts: [
      { label: 'Nombre y Apellido', value: input.person.name },
      { label: 'DNI', value: input.person.dni || '—' },
      { label: 'Legajo', value: String(input.person.employeeNumber) },
      { label: 'Rol', value: input.person.roleLabels.join(', ') || '—' },
      { label: 'Período', value: fullPeriod },
      ...(absencesCount > 0
        ? [{ label: 'Inasistencias', value: String(absencesCount) }]
        : []),
      ...(leavesCount > 0
        ? [{ label: 'Licencias', value: String(leavesCount) }]
        : []),
      ...(input.workdays
        ? [{ label: 'Jornadas', value: String(input.workdays.length) }]
        : []),
    ],
    sections,
    grandTotal: both
      ? {
          label: 'Total general (empleado y coordinador)',
          value: formatMinutes(totalMinutes),
        }
      : undefined,
    totalMinutes,
    signers: ['Responsable (administración)', input.person.signerLabel],
    consentText: includeServices
      ? ATTENDANCE_CONSENT_TEXT
      : WORKDAYS_CONSENT_TEXT,
    documentTitle: `${title} - ${input.person.name} - ${input.from} al ${input.to}`,
  }
}

function buildServicesSection(
  input: {
    from: string
    to: string
    entries: AttendanceDetailEntry[]
    leaves?: EmployeeLeave[]
    now?: Date
  },
  withHeading: boolean,
): {
  section: AttendanceSheetSection
  absencesCount: number
  leavesCount: number
} {
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
  const totalMinutes = sumWorkedMinutes(lines)
  const absencesCount = lines.filter((entry) =>
    isAbsenceEntry(entry, now),
  ).length

  const columns: PrintColumn[] = [
    { key: 'date', header: 'Fecha' },
    { key: 'client', header: 'Cliente', wrap: true },
    { key: 'site', header: 'Sede', wrap: true },
    { key: 'franja', header: 'Franja' },
    { key: 'start', header: 'Inicio' },
    { key: 'end', header: 'Fin' },
    // B1 (B-20): validación por ubicación, solo el resultado, sin coordenadas.
    { key: 'geo', header: 'Validación' },
    { key: 'novelty', header: 'Observaciones', wrap: true },
    { key: 'hours', header: 'Horas', align: 'right' },
  ]

  const spans: Record<string, PrintRowSpan> = {}
  const rows: PrintRowData[] = allLines.map((line) => {
    if (line.type === 'leave') {
      spans[`leave-${line.leave.id}`] = { from: 'client', to: 'novelty' }
      return {
        key: `leave-${line.leave.id}`,
        date: formatPeriodDate(line.date),
        // La observación va en la celda unida que arranca en Cliente y llega hasta Observaciones (`spans`).
        client: leaveSheetNote(line.leave),
        site: '',
        franja: '',
        start: '',
        end: '',
        geo: '',
        novelty: '',
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
      client: entry.row.clientName,
      site: entry.row.siteName,
      franja: entryFranja(entry),
      start: checkIn ? formatTime(checkIn) : '—',
      end: checkOut ? formatTime(checkOut) : '—',
      geo: geoPrintText(entry.row.checkInGeo, entry.row.checkOutGeo),
      // AJ2-15: la observación del turno (si tiene tildado «mostrar en la impresión») va junto a la novedad.
      novelty: joinObservations(
        absent ? absenceSheetNote(entry.row) : '',
        entry.row.shiftObservation,
      ),
      hours: worked != null ? formatMinutes(worked) : '—',
    }
  })

  return {
    absencesCount,
    leavesCount: leaves.length,
    section: {
      key: 'services',
      heading: withHeading ? SERVICES_SECTION_HEADING : undefined,
      columns,
      rows,
      spans,
      footer: {
        label: withHeading ? 'Total como empleado' : 'Total del período',
        value: formatMinutes(totalMinutes),
      },
      emptyText: 'No hay horas registradas en este período.',
      totalMinutes,
    },
  }
}
