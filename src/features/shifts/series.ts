import { addDays, format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import type { DateShiftOverlaps } from '@/api/overlaps'
import type {
  CreateShiftSeriesCreated,
  ShiftSeriesPreview,
  ShiftSeriesRule,
} from '@/api/shifts'
import { timeRangeText } from '@/features/services/serviceChanges'
import { formatDateOnly } from '@/features/settings/dateOnly'
import { conflictShiftIdOf } from '@/features/shifts/conflictLink'
import {
  assignedWarningLines,
  rejectedLines,
} from '@/features/shifts/assignOnCreate'

/**
 * AJ3-08: textos y agrupaciones puras de «Repetir este turno» (aviso en vivo
 * de la vista previa y resumen de lo que no se pudo asignar), sin React ni
 * red para poder probarlas solas.
 */

/** Cuántas fechas se listan antes de «… y N más». */
export const SERIES_VISIBLE_DATES = 8

/** «lun 13 oct, lun 20 oct… y 3 más» (hasta `max` fechas). */
export function formatSeriesDates(
  dates: string[],
  max = SERIES_VISIBLE_DATES,
): string {
  const visible = dates.slice(0, max).map(formatDateOnly).join(', ')
  const rest = dates.length - max
  return rest > 0 ? `${visible}… y ${rest} más` : visible
}

export interface SeriesPreviewText {
  /** `none` = ninguna fecha cumple (el botón de crear queda deshabilitado). */
  kind: 'none' | 'some'
  headline: string
  datesLine: string | null
  holidaysLine: string | null
}

/** Aviso en vivo a partir de la respuesta de `preview_shift_series`. */
export function describeSeriesPreview(
  preview: ShiftSeriesPreview,
): SeriesPreviewText {
  const holidaysLine =
    preview.holidaysSkipped.length > 0
      ? `${
          preview.holidaysSkipped.length === 1
            ? 'Se saltea 1 feriado'
            : `Se saltean ${preview.holidaysSkipped.length} feriados`
        }: ${formatSeriesDates(preview.holidaysSkipped)}.`
      : null
  if (preview.count === 0) {
    return {
      kind: 'none',
      headline: 'Ninguna fecha cumple la regla elegida.',
      datesLine: null,
      holidaysLine,
    }
  }
  return {
    kind: 'some',
    headline:
      preview.count === 1
        ? 'Se va a crear 1 turno.'
        : `Se van a crear ${preview.count} turnos.`,
    datesLine: formatSeriesDates(preview.dates),
    holidaysLine,
  }
}

/** «Se crearon N turnos», más los feriados salteados si hubo. */
export function seriesSuccessMessage(
  createdCount: number,
  skippedHolidays: number,
): string {
  const base =
    createdCount === 1 ? 'Se creó 1 turno' : `Se crearon ${createdCount} turnos`
  if (skippedHolidays === 0) {
    return `${base}.`
  }
  return `${base}. ${
    skippedHolidays === 1
      ? 'Se salteó 1 feriado.'
      : `Se saltearon ${skippedHolidays} feriados.`
  }`
}

export interface SeriesDateIssue {
  /** Fecha del turno (`AAAA-MM-DD`). */
  date: string
  lines: string[]
  /** OF-08: turnos con los que chocó alguna persona rechazada («Ver turno»). */
  conflictShiftIds: string[]
}

/**
 * Resumen por fecha de lo que no salió limpio: empleados rechazados (con el
 * `message` del servidor tal cual) y asignados con advertencias. Las fechas
 * sin novedades no aparecen.
 */
export function seriesIssuesByDate(
  created: CreateShiftSeriesCreated[],
  names: Record<string, string>,
  warningMessages: Record<string, string>,
): SeriesDateIssue[] {
  return created
    .map((item) => ({
      date: item.shiftDate,
      lines: [
        ...rejectedLines(item.rejected),
        ...assignedWarningLines(item.assigned, names, warningMessages).map(
          (line) => `${line.employeeName}: ${line.messages.join(' ')}`,
        ),
      ],
      conflictShiftIds: item.rejected.flatMap((rejected) => {
        const shiftId = conflictShiftIdOf(rejected.detail)
        return shiftId ? [shiftId] : []
      }),
    }))
    .filter((issue) => issue.lines.length > 0)
}

/** Título del aviso cuando algunas fechas quedaron con novedades de asignación. */
export function seriesIssuesTitle(
  createdCount: number,
  hasRejected: boolean,
): string {
  const created =
    createdCount === 1 ? 'Se creó 1 turno' : `Se crearon ${createdCount} turnos`
  return hasRejected
    ? `${created}, pero a algunas personas no se las pudo asignar:`
    : `${created} y se asignó, con advertencias:`
}

/** «mar 18/11» a partir de `AAAA-MM-DD`. */
function shortDayMonth(isoDate: string): string {
  return format(parseISO(isoDate), 'EEE d/M', { locale: es })
}

/**
 * OF-21: una línea por coincidencia de «Repetir este turno»:
 * «El mar 18/11 ya hay “X” de 08:00 a 12:00» (sin servicio: «un turno cargado a mano»).
 */
export function seriesDuplicateLines(items: DateShiftOverlaps[]): string[] {
  return items.flatMap((item) =>
    item.overlaps.map((overlap) => {
      const what = overlap.serviceName
        ? `“${overlap.serviceName}”`
        : 'un turno cargado a mano'
      return `El ${shortDayMonth(item.date)} ya hay ${what} ${timeRangeText(overlap.startTime, overlap.endTime, overlap.openEnded)}`
    }),
  )
}

/**
 * OF-21, «Sacar esas fechas»: `create_shift_series` no recibe fechas
 * excluidas, así que la regla se parte en tramos de calendario que dejan
 * afuera cada fecha a sacar. Las demás condiciones (días, semanas del mes,
 * feriados) las sigue aplicando el servidor sobre cada tramo.
 */
export function splitRuleAroundDates(
  rule: ShiftSeriesRule,
  excludedDates: string[],
): ShiftSeriesRule[] {
  const excluded = [...new Set(excludedDates)]
    .filter((date) => date >= rule.from && date <= rule.to)
    .sort()
  const ranges: ShiftSeriesRule[] = []
  let from = rule.from
  for (const date of excluded) {
    const before = format(addDays(parseISO(date), -1), 'yyyy-MM-dd')
    if (from <= before) {
      ranges.push({ ...rule, from, to: before })
    }
    from = format(addDays(parseISO(date), 1), 'yyyy-MM-dd')
  }
  if (from <= rule.to) {
    ranges.push({ ...rule, from, to: rule.to })
  }
  return ranges
}
