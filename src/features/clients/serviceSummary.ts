import { formatTaxId } from '@/lib/taxId'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import type { ClientServiceSummary } from '@/api/clients'
import type { PrintColumn, PrintRowData } from '@/features/print/PrintTable'
import { formatCalendarDate, formatMinutes } from '@/lib/format'

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

/**
 * Arma la hoja «Resumen de servicios» del cliente: datos del cliente y del
 * período, una fila por turno realizado (fecha, sede, franja, empleados y
 * horas) y los totales. Lleva un solo espacio de firma, el del responsable de
 * administración (no hay una segunda parte que conforme el resumen).
 */
export function buildClientSummarySheet(input: {
  clientName: string
  cuit: string | null
  summary: ClientServiceSummary
}): ClientSummarySheetModel {
  const { summary } = input
  const columns: PrintColumn[] = [
    { key: 'date', header: 'Fecha' },
    { key: 'site', header: 'Sede' },
    { key: 'franja', header: 'Franja' },
    { key: 'employees', header: 'Empleados' },
    { key: 'hours', header: 'Horas', align: 'right' },
  ]
  const rows: PrintRowData[] = summary.shifts.map((shift) => ({
    key: shift.shiftId,
    date: formatCalendarDate(shift.shiftDate),
    site: shift.siteName,
    franja: `${shift.startTime.slice(0, 5)}–${shift.endTime.slice(0, 5)}`,
    employees: shiftEmployeeNames(shift).join('; ') || '—',
    hours: formatMinutes(shift.workedMinutes),
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
