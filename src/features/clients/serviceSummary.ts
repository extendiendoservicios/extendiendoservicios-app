import { formatTaxId } from '@/lib/taxId'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import type { ClientServiceSummary } from '@/api/clients'
import type { AttendanceBoardRow } from '@/api/attendance'
import { absenceDetail, isAbsence } from '@/features/attendance/absences'
import { joinObservations } from '@/features/shifts/observation'
import type { PrintColumn, PrintRowData } from '@/features/print/PrintTable'
import { formatCalendarDate, formatMinutes } from '@/lib/format'
import {
  formatShiftRange,
  NO_CHECKOUT_LABEL,
} from '@/features/shifts/openEnded'

/**
 * Lógica sin React del resumen de servicios por cliente (AJ-09) y de la
 * columna «Horas (mes)» del listado de Clientes (AJ-10).
 */

/**
 * Período «mes en curso»: del día 1 a hoy. `today` es `"YYYY-MM-DD"` en hora
 * de Argentina (`todayInBuenosAires`), inyectable para los tests.
 */
export function currentMonthRange(today: string): { from: string; to: string } {
  return { from: `${today.slice(0, 8)}01`, to: today }
}

/** Nombre del mes en minúscula: «octubre». */
export function monthName(isoDate: string): string {
  const [year = 0, month = 1] = isoDate.slice(0, 7).split('-').map(Number)
  return format(new Date(year, month - 1, 1), 'LLLL', { locale: es })
}

/** Texto de horas del listado: «0 h» si no hubo trabajo, si no «12 h 30 min». */
export function formatWorkedHours(minutes: number | undefined): string {
  return minutes ? formatMinutes(minutes) : '0 h'
}

export const CLIENT_SUMMARY_SHEET_TITLE = 'Resumen de servicios'

export interface ClientSummarySheetModel {
  title: string
  facts: { label: string; value: string }[]
  columns: PrintColumn[]
  rows: PrintRowData[]
  footer: { label: string; value: string }
  signers: string[]
  documentTitle: string
}

/**
 * Empleados que trabajaron en el turno (con inicio registrado), por apellido,
 * como «Apellido, Nombre».
 */
export function shiftEmployeeNames(
  shift: ClientServiceSummary['shifts'][number],
): string[] {
  return shift.employees
    .filter((employee) => employee.checkInAt != null)
    .map((employee) => `${employee.lastName}, ${employee.firstName}`)
}

/** Ids de los empleados que aparecen en la hoja (con inicio o con inasistencia), sin repetir. */
export function summarySheetEmployeeIds(
  summary: ClientServiceSummary,
  absences: AttendanceBoardRow[],
): string[] {
  const ids = new Set<string>()
  for (const shift of summary.shifts) {
    for (const employee of shift.employees) {
      if (employee.checkInAt != null) {
        ids.add(employee.employeeId)
      }
    }
  }
  for (const row of absences) {
    ids.add(row.employeeId)
  }
  return [...ids]
}

interface SheetLine {
  key: string
  shiftDate: string
  startTime: string
  siteName: string
  lastName: string
  firstName: string
  employeeId: string
  franja: string
  novelty: string
  hours: string
}

/**
 * Arma la hoja «Resumen de servicios» del cliente: datos del cliente y del
 * período, una fila por persona y turno (fecha, sede, franja, nombre y
 * apellido, DNI, novedad y horas) y los totales. Desde AJ2-14 incluye las
 * inasistencias (`absences`: asignaciones sin inicio de turnos del período;
 * se filtran con `isAbsence`), con el motivo del aviso si lo hay. Lleva un
 * solo espacio de firma, el del responsable de administración (no hay una
 * segunda parte que conforme el resumen).
 */
export function buildClientSummarySheet(input: {
  clientName: string
  cuit: string | null
  summary: ClientServiceSummary
  /** Asignaciones vigentes sin inicio del período (`fetchClientUnstartedAssignments`). */
  absences?: AttendanceBoardRow[]
  /** DNI por id de empleado (`fetchEmployeeDnisByIds`). */
  dnis?: Map<string, string>
  /** Inyectable para tests; por defecto el momento de armar la hoja. */
  now?: Date
}): ClientSummarySheetModel {
  const { summary } = input
  const now = input.now ?? new Date()
  const dnis = input.dnis ?? new Map<string, string>()
  const columns: PrintColumn[] = [
    { key: 'date', header: 'Fecha' },
    { key: 'site', header: 'Sede' },
    { key: 'franja', header: 'Franja' },
    { key: 'name', header: 'Nombre y Apellido' },
    { key: 'dni', header: 'DNI' },
    { key: 'novelty', header: 'Observaciones' },
    { key: 'hours', header: 'Horas', align: 'right' },
  ]

  const lines: SheetLine[] = []
  for (const shift of summary.shifts) {
    for (const employee of shift.employees) {
      if (employee.checkInAt == null) {
        continue
      }
      lines.push({
        key: employee.assignmentId,
        shiftDate: shift.shiftDate,
        startTime: shift.startTime,
        siteName: shift.siteName,
        lastName: employee.lastName,
        firstName: employee.firstName,
        employeeId: employee.employeeId,
        // AJ2-10: en un turno «A terminar» la franja dice «A terminar», nunca 23:59.
        franja: formatShiftRange(
          shift.startTime,
          shift.endTime,
          shift.openEnded,
        ),
        // «Sin salida» (AJ2-10): suma 0 horas hasta que administración cargue la hora.
        // AJ2-15: la observación del turno (si se imprime) va junto a la novedad.
        novelty: joinObservations(
          employee.noCheckout ? NO_CHECKOUT_LABEL : '',
          shift.observation,
        ),
        hours: employee.noCheckout
          ? '0 h'
          : employee.workedMinutes != null
            ? formatMinutes(employee.workedMinutes)
            : '—',
      })
    }
  }
  const absentRows = (input.absences ?? []).filter((row) => isAbsence(row, now))
  for (const row of absentRows) {
    lines.push({
      key: row.id,
      shiftDate: row.shiftDate,
      startTime: row.startTime,
      siteName: row.siteName,
      lastName: row.employeeLastName,
      firstName: row.employeeFirstName,
      employeeId: row.employeeId,
      franja: formatShiftRange(row.startTime, row.endTime, row.openEnded),
      novelty: joinObservations(absenceDetail(row), row.shiftObservation),
      hours: '—',
    })
  }
  lines.sort(
    (a, b) =>
      a.shiftDate.localeCompare(b.shiftDate) ||
      a.startTime.localeCompare(b.startTime) ||
      a.siteName.localeCompare(b.siteName) ||
      a.lastName.localeCompare(b.lastName) ||
      a.firstName.localeCompare(b.firstName) ||
      a.key.localeCompare(b.key),
  )

  const rows: PrintRowData[] = lines.map((line) => ({
    key: line.key,
    date: formatCalendarDate(line.shiftDate),
    site: line.siteName,
    franja: line.franja,
    name: `${line.firstName} ${line.lastName}`,
    dni: dnis.get(line.employeeId) ?? '—',
    novelty: line.novelty,
    hours: line.hours,
  }))

  return {
    title: CLIENT_SUMMARY_SHEET_TITLE,
    facts: [
      { label: 'Cliente', value: input.clientName },
      ...(input.cuit
        ? [{ label: 'CUIT', value: formatTaxId(input.cuit) }]
        : []),
      {
        label: 'Período',
        value: `${formatCalendarDate(summary.from)} al ${formatCalendarDate(summary.to)}`,
      },
      {
        label: 'Turnos realizados',
        value: String(summary.totals.shiftsDone),
      },
      {
        label: 'Empleados distintos',
        value: String(summary.totals.employeesCount),
      },
      ...(summary.totals.openEndedShifts > 0
        ? [
            {
              label: 'Turnos «A terminar»',
              value: String(summary.totals.openEndedShifts),
            },
          ]
        : []),
      ...(absentRows.length > 0
        ? [{ label: 'Inasistencias', value: String(absentRows.length) }]
        : []),
    ],
    columns,
    rows,
    footer: {
      label: 'Horas totales',
      value: formatMinutes(summary.totals.workedMinutes),
    },
    signers: ['Responsable (administración)'],
    documentTitle: `Resumen de servicios - ${input.clientName} - ${summary.from} al ${summary.to}`,
  }
}
