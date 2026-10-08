import type { AttendanceBoardRow } from '@/api/attendance'
import type { SupervisionListRow } from '@/api/supervisions'
import { formatCalendarDate, formatMinutes, formatTime } from '@/lib/format'
import type { PrintColumn, PrintRowData } from '@/features/print/PrintTable'

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

/** Franja `08:00–12:00` de la fila. */
export function entryFranja(entry: AttendanceDetailEntry): string {
  return `${entry.row.startTime.slice(0, 5)}–${entry.row.endTime.slice(0, 5)}`
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

/**
 * Qué filas entran en la hoja: las que tienen un inicio registrado (trabajo
 * efectivo o en curso). Quedan afuera los turnos cancelados, las ausencias y
 * los «sin registro»: la hoja deja constancia de horas, no de faltas.
 */
export function printableEntries(
  entries: AttendanceDetailEntry[],
): AttendanceDetailEntry[] {
  return entries.filter((entry) => entryCheckIn(entry) != null)
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
}): AttendanceSheetModel {
  const lines = printableEntries(input.entries).sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startTime.localeCompare(b.startTime) ||
      a.key.localeCompare(b.key),
  )
  const hasSupervisions = lines.some((entry) => entry.kind === 'supervision')
  const totalMinutes = sumWorkedMinutes(lines)

  const columns: PrintColumn[] = [
    { key: 'date', header: 'Fecha' },
    ...(hasSupervisions ? [{ key: 'kind', header: 'Tipo' }] : []),
    { key: 'client', header: 'Cliente' },
    { key: 'site', header: 'Sede' },
    { key: 'franja', header: 'Franja' },
    { key: 'start', header: 'Inicio' },
    { key: 'end', header: 'Fin' },
    { key: 'hours', header: 'Horas', align: 'right' },
  ]

  const rows: PrintRowData[] = lines.map((entry) => {
    const checkIn = entryCheckIn(entry)
    const checkOut = entryCheckOut(entry)
    const worked = entryWorkedMinutes(entry)
    return {
      key: entry.key,
      date: formatPeriodDate(entry.date),
      kind: ENTRY_KIND_LABELS[entry.kind],
      client: entry.row.clientName,
      site: entry.row.siteName,
      franja: entryFranja(entry),
      start: checkIn ? formatTime(checkIn) : '—',
      end: checkOut ? formatTime(checkOut) : '—',
      hours: worked != null ? formatMinutes(worked) : '—',
    }
  })

  const fullPeriod = `${formatPeriodDate(input.from)} al ${formatPeriodDate(input.to)}`
  return {
    title: ATTENDANCE_SHEET_TITLE,
    facts: [
      { label: 'Persona', value: input.person.name },
      { label: 'Legajo', value: String(input.person.employeeNumber) },
      { label: 'Rol', value: input.person.roleLabels.join(', ') || '—' },
      { label: 'Período', value: fullPeriod },
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
