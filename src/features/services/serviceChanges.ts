import type {
  ServiceChangesResult,
  ServiceChangesUpdated,
  ServiceDetail,
  ServiceFormInput,
  ServicePrevious,
} from '@/api/services'
import type { ServiceOverlap, ShiftOverlap } from '@/api/overlaps'
import { formatDateOnly } from '@/features/settings/dateOnly'

/**
 * Textos y cálculos de OF-05 (los cambios del servicio llegan a los turnos) y
 * OF-02 (aviso de duplicados). Sin React: se prueban aparte.
 */

/** `"08:00:00"` → `"08:00"`. */
function hhmm(time: string): string {
  return time.slice(0, 5)
}

function sameNumbers(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value))
}

function normalizeWeeks(weeks: number[] | null): number[] | null {
  return weeks && weeks.length > 0 ? weeks : null
}

/** `p_previous` de `apply_service_changes`: los valores del servicio ANTES de guardar. */
export function buildServicePrevious(before: ServiceDetail): ServicePrevious {
  return {
    start_time: before.startTime,
    end_time: before.endTime,
    open_ended: before.openEnded,
    required_staff: before.requiredStaff,
    requires_photos: before.requiresPhotos,
  }
}

/**
 * ¿El cambio toca algo que llega a los turnos? Días, semanas del mes, horario,
 * «A terminar», dotación, «trabaja feriados», vigencia o fotos (OF-05).
 */
export function serviceChangesAffectShifts(
  before: ServiceDetail,
  after: ServiceFormInput,
): boolean {
  const beforeWeeks = normalizeWeeks(before.weeksOfMonth)
  const afterWeeks = normalizeWeeks(after.weeksOfMonth)
  const weeksChanged =
    (beforeWeeks === null) !== (afterWeeks === null) ||
    (beforeWeeks !== null &&
      afterWeeks !== null &&
      !sameNumbers(beforeWeeks, afterWeeks))
  const timeChanged =
    hhmm(before.startTime) !== hhmm(after.startTime) ||
    before.openEnded !== after.openEnded ||
    (!after.openEnded &&
      hhmm(before.endTime) !== hhmm(after.endTime ?? before.endTime))
  return (
    !sameNumbers(before.weekdays, after.weekdays) ||
    weeksChanged ||
    timeChanged ||
    before.requiredStaff !== after.requiredStaff ||
    before.worksOnHolidays !== after.worksOnHolidays ||
    before.validFrom !== after.validFrom ||
    (before.validTo ?? null) !== (after.validTo ?? null) ||
    before.requiresPhotos !== after.requiresPhotos
  )
}

/**
 * OF-05b: ¿el cambio puede agregar días con turno? Solo si cambiaron los días,
 * las semanas del mes, «trabaja feriados» o la vigencia (desde/hasta). Si no
 * (por ejemplo, solo la dotación o el horario) la pantalla manda
 * `p_create_missing = false`: se actualizan los turnos que existen y no se
 * genera ninguno, para no recrear turnos borrados a propósito.
 */
export function serviceChangesCanAddShifts(
  before: ServiceDetail,
  after: ServiceFormInput,
): boolean {
  const beforeWeeks = normalizeWeeks(before.weeksOfMonth)
  const afterWeeks = normalizeWeeks(after.weeksOfMonth)
  const weeksChanged =
    (beforeWeeks === null) !== (afterWeeks === null) ||
    (beforeWeeks !== null &&
      afterWeeks !== null &&
      !sameNumbers(beforeWeeks, afterWeeks))
  return (
    !sameNumbers(before.weekdays, after.weekdays) ||
    weeksChanged ||
    before.worksOnHolidays !== after.worksOnHolidays ||
    before.validFrom !== after.validFrom ||
    (before.validTo ?? null) !== (after.validTo ?? null)
  )
}

/**
 * OF-02: ¿conviene revisar duplicados al guardar? Siempre en el alta; en la
 * edición solo si cambió la sede, los días, el horario o si el servicio vuelve
 * a estar activo (así un duplicado que ya existe no molesta en cada edición).
 */
export function shouldCheckServiceOverlaps(
  before: ServiceDetail | undefined,
  after: ServiceFormInput,
): boolean {
  if (after.status !== 'active') {
    return false
  }
  if (!before) {
    return true
  }
  return (
    before.status !== 'active' ||
    before.siteId !== after.siteId ||
    !sameNumbers(before.weekdays, after.weekdays) ||
    hhmm(before.startTime) !== hhmm(after.startTime) ||
    before.openEnded !== after.openEnded ||
    (!after.openEnded &&
      hhmm(before.endTime) !== hhmm(after.endTime ?? before.endTime))
  )
}

// -------------------------------------------------------------------------
// Textos
// -------------------------------------------------------------------------

const WEEKDAY_PLURAL: Record<number, string> = {
  0: 'domingos',
  1: 'lunes',
  2: 'martes',
  3: 'miércoles',
  4: 'jueves',
  5: 'viernes',
  6: 'sábados',
}

/** `[1, 2]` → `"los lunes y martes"`; `[1]` → `"los lunes"`. Semana desde el lunes. */
export function pluralWeekdays(weekdays: number[]): string {
  const ordered = [1, 2, 3, 4, 5, 6, 0].filter((day) => weekdays.includes(day))
  const names = ordered.map((day) => WEEKDAY_PLURAL[day] as string)
  if (names.length === 0) {
    return ''
  }
  if (names.length === 1) {
    return `los ${names[0]}`
  }
  return `los ${names.slice(0, -1).join(', ')} y ${names.at(-1)}`
}

/** `"de 15:00 a 17:00"`; con «A terminar»: `"desde las 08:00 (a terminar)"`. */
export function timeRangeText(
  start: string,
  end: string,
  openEnded: boolean,
): string {
  return openEnded
    ? `desde las ${hhmm(start)} (a terminar)`
    : `de ${hhmm(start)} a ${hhmm(end)}`
}

/** «Ya existe “X” en esta sede los lunes y martes de 15:00 a 17:00.» */
export function describeServiceOverlap(overlap: ServiceOverlap): string {
  return `Ya existe “${overlap.serviceName}” en esta sede ${pluralWeekdays(overlap.commonWeekdays)} ${timeRangeText(overlap.startTime, overlap.endTime, overlap.openEnded)}.`
}

/** Texto completo del aviso, con la pregunta al final. */
export function serviceOverlapsMessage(overlaps: ServiceOverlap[]): string {
  if (overlaps.length === 1) {
    return `${describeServiceOverlap(overlaps[0] as ServiceOverlap)} ¿Guardar igual?`
  }
  return 'Ya existen en esta sede servicios que coinciden en día y horario. ¿Guardar igual?'
}

/** «Esta sede ya tiene el turno “X” ese día de 12:30 a 14:30.» */
export function describeShiftOverlap(overlap: ShiftOverlap): string {
  const what = overlap.serviceName
    ? `el turno “${overlap.serviceName}”`
    : 'un turno cargado a mano'
  return `Esta sede ya tiene ${what} ese día ${timeRangeText(overlap.startTime, overlap.endTime, overlap.openEnded)}.`
}

export function shiftOverlapsMessage(overlaps: ShiftOverlap[]): string {
  if (overlaps.length === 1) {
    return `${describeShiftOverlap(overlaps[0] as ShiftOverlap)} ¿Crear igual?`
  }
  return 'Esta sede ya tiene turnos ese día que se superponen en horario. ¿Crear igual?'
}

function countText(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/**
 * Resumen de una línea de la vista previa o del resultado. Con `done` va en
 * pasado («Borramos 2 turnos…»); sin `done`, en presente («Se borran 2…»).
 */
export function summarizeServiceChanges(
  result: ServiceChangesResult,
  done: boolean,
): string {
  const parts: string[] = []
  if (result.deletedCount > 0) {
    parts.push(
      done
        ? `borramos ${countText(result.deletedCount, 'turno', 'turnos')}`
        : `se ${result.deletedCount === 1 ? 'borra' : 'borran'} ${countText(result.deletedCount, 'turno', 'turnos')}`,
    )
  }
  if (result.updatedCount > 0) {
    parts.push(
      done
        ? `actualizamos ${countText(result.updatedCount, 'turno', 'turnos')}`
        : `se ${result.updatedCount === 1 ? 'actualiza' : 'actualizan'} ${countText(result.updatedCount, 'turno', 'turnos')}`,
    )
  }
  if (result.createdCount > 0) {
    parts.push(
      done
        ? `creamos ${countText(result.createdCount, 'turno', 'turnos')}`
        : `se ${result.createdCount === 1 ? 'crea' : 'crean'} ${countText(result.createdCount, 'turno', 'turnos')}`,
    )
  }
  if (result.skippedCount > 0) {
    parts.push(
      done
        ? `salteamos ${countText(result.skippedCount, 'turno', 'turnos')}`
        : `se ${result.skippedCount === 1 ? 'saltea' : 'saltean'} ${countText(result.skippedCount, 'turno', 'turnos')}`,
    )
  }
  if (parts.length === 0) {
    return done
      ? 'No hizo falta cambiar ningún turno.'
      : 'Los turnos ya están al día: no hay nada para cambiar.'
  }
  const text = parts.join('; ')
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`
}

/** ¿La respuesta no trae ningún cambio ni aviso? */
export function isServiceChangesEmpty(result: ServiceChangesResult): boolean {
  return (
    result.deletedCount === 0 &&
    result.updatedCount === 0 &&
    result.createdCount === 0 &&
    result.skipped.length === 0 &&
    result.unassigned.length === 0
  )
}

function timeChangeText(
  time: NonNullable<ServiceChangesUpdated['time']>,
): string {
  const describe = (value: {
    startTime: string
    endTime: string
    openEnded: boolean
  }) =>
    value.openEnded
      ? `${hhmm(value.startTime)} a terminar`
      : `${hhmm(value.startTime)} a ${hhmm(value.endTime)}`
  return `Horario: ${describe(time.from)} → ${describe(time.to)}`
}

/** Líneas de lo que cambia en un turno actualizado, con lo que se quitó o se conservó. */
export function describeUpdatedShift(item: ServiceChangesUpdated): string[] {
  const lines: string[] = []
  if (item.time) {
    lines.push(timeChangeText(item.time))
  }
  if (item.requiredStaff) {
    lines.push(
      `Dotación: ${item.requiredStaff.from} → ${item.requiredStaff.to}`,
    )
  }
  if (item.requiresPhotos) {
    lines.push(
      item.requiresPhotos.to ? 'Pasa a pedir fotos' : 'Deja de pedir fotos',
    )
  }
  for (const removed of item.removed) {
    lines.push(`Se quita a la persona asignada: ${removed.message}`)
  }
  for (const kept of item.kept) {
    lines.push(kept.message)
  }
  return lines
}

/** Fecha corta en español de Argentina para las listas del detalle. */
export function shiftDateText(isoDate: string): string {
  return formatDateOnly(isoDate)
}
