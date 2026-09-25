import { addDays, format } from 'date-fns'
import { es } from 'date-fns/locale'

/**
 * Formato de una columna `date` pura (sin hora): `holidays.holiday_date`,
 * `rating_criteria.valid_from`/`valid_to`. A diferencia de `formatShortDate`
 * (`src/lib/format.ts`, pensado para `timestamptz`), acá NO hay que pasar
 * por la zona horaria de Buenos Aires -- un `date` de Postgres ya es un día
 * de calendario, sin instante asociado. Si se le aplicara el contexto de
 * zona de `formatShortDate` a la medianoche UTC que arma `new Date('2026-
 * 01-01')`, el resultado se correría un día para atrás (21 h del día
 * anterior en Argentina). En cambio, se arman los componentes de fecha a
 * mano y se formatean con el reloj local del entorno, sin ninguna conversión
 * de por medio -- así el día que se ve es siempre el que dice la cadena.
 */
function parseIsoDateParts(isoDate: string): {
  year: number
  month: number
  day: number
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) {
    throw new Error(`Fecha con formato inesperado: "${isoDate}".`)
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }
}

export function formatDateOnly(isoDate: string): string {
  const { year, month, day } = parseIsoDateParts(isoDate)
  return format(new Date(year, month - 1, day), 'EEE d MMM', { locale: es })
}

/** Igual que `formatDateOnly`, pero con el año (para fechas de otros años). */
export function formatDateOnlyWithYear(isoDate: string): string {
  const { year, month, day } = parseIsoDateParts(isoDate)
  return format(new Date(year, month - 1, day), 'EEE d MMM yyyy', {
    locale: es,
  })
}

/**
 * `Date` (hora local del navegador, la que devuelve `DatePicker`) a
 * `yyyy-MM-dd`, sin pasar por UTC: evita el corrimiento de un día que daría
 * `date.toISOString()` en husos horarios negativos como el de Argentina.
 */
export function localDateToIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Suma (o resta, con `days` negativo) días de calendario a una fecha
 * `"yyyy-MM-dd"`, sin pasar por UTC (`addDays` de date-fns opera sobre el
 * reloj local, igual criterio que `localDateToIsoDate`). Usada por la
 * navegación "día anterior/siguiente" de ADM-05.
 */
export function addDaysToIsoDate(isoDate: string, days: number): string {
  const { year, month, day } = parseIsoDateParts(isoDate)
  return localDateToIsoDate(addDays(new Date(year, month - 1, day), days))
}

/**
 * Día de la semana de una fecha `"yyyy-MM-dd"` (0 = domingo .. 6 = sábado),
 * mismo criterio que `extract(dow from ...)` de Postgres (usado por
 * `employee_availability.weekday` y por `assign_employee` en
 * `0024_rpc_assignments.sql`) -- ASSIGN-012, para marcar "disponible ese
 * día" en ADM-08 con la misma regla que aplica el servidor. Igual que
 * `formatDateOnly`, arma la fecha a mano y usa el reloj local: es un día de
 * calendario puro, sin instante asociado.
 */
export function weekdayOfIsoDate(isoDate: string): number {
  const { year, month, day } = parseIsoDateParts(isoDate)
  return new Date(year, month - 1, day).getDay()
}
