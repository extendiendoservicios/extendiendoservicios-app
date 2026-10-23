import type { MyWorkday } from '@/api/myWorkdays'
import type { TodayShift } from '@/api/supervisorToday'
import { openSupervisionOf } from './workday'

/**
 * Lógica pura de la lista de turnos del día del coordinador (P24.2, CJ-02,
 * CJ-04, CJ-25) y de las condiciones para tomar un turno (CJ-07, CJ-08, CJ-27).
 */

const STATE_RANK: Record<TodayShift['displayState'], number> = {
  in_progress: 0,
  pending: 1,
  finished: 2,
}

/**
 * Estado a mostrar del turno, derivado de la hora y no del estado guardado
 * (`v_supervisor_today.display_state` solo mira `shifts.status`, que sigue en
 * `scheduled` aunque el turno ya haya pasado). Usa los instantes `startsAt` y
 * `endsAt` (ya resuelven los turnos que cruzan medianoche):
 * - terminado si el turno est� completado o su fin ya pas�;
 * - en curso si est� en curso o su inicio ya pas� (sin fin: �A terminar�, sigue
 *   en curso hasta que se complete);
 * - por empezar en cualquier otro caso.
 * `nowMs` es inyectable para los tests; en la pantalla es la hora del dispositivo,
 * solo para ordenar y rotular (ninguna regla depende de ella).
 */
export function effectiveShiftState(
  shift: TodayShift,
  nowMs: number = Date.now(),
): TodayShift['displayState'] {
  if (shift.displayState === 'finished') return 'finished'
  const endsMs =
    !shift.openEnded && shift.endsAt != null ? Date.parse(shift.endsAt) : NaN
  if (!Number.isNaN(endsMs) && nowMs >= endsMs) return 'finished'
  if (shift.displayState === 'in_progress') return 'in_progress'
  const startsMs = shift.startsAt != null ? Date.parse(shift.startsAt) : NaN
  if (!Number.isNaN(startsMs) && nowMs >= startsMs) return 'in_progress'
  return 'pending'
}

/** En cada bloque: primero los turnos en curso, despu�s los que faltan y al final los terminados (CJ-25). */
export function sortShifts(
  shifts: TodayShift[],
  nowMs: number = Date.now(),
): TodayShift[] {
  return [...shifts].sort(
    (a, b) =>
      STATE_RANK[effectiveShiftState(a, nowMs)] -
        STATE_RANK[effectiveShiftState(b, nowMs)] ||
      a.startTime.localeCompare(b.startTime) ||
      a.siteName.localeCompare(b.siteName, 'es'),
  )
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/** `true` si el cliente o la sede contienen el texto buscado (sin acentos ni mayúsculas). */
export function matchesShiftSearch(shift: TodayShift, search: string): boolean {
  const query = normalize(search.trim())
  if (query === '') return true
  return (
    normalize(shift.clientName).includes(query) ||
    normalize(shift.siteName).includes(query)
  )
}

/**
 * Los dos bloques de SUP-02: «Mis sedes» (prioridad propia, por sede o por
 * cliente, CJ-24) y «Otras sedes», con buscador por cliente o sede (solo
 * filtra «Otras sedes», CJ-25).
 */
export function splitTodayShifts(
  shifts: TodayShift[],
  search = '',
  nowMs: number = Date.now(),
): { mine: TodayShift[]; others: TodayShift[] } {
  return {
    mine: sortShifts(
      shifts.filter((shift) => shift.isPriority),
      nowMs,
    ),
    others: sortShifts(
      shifts.filter(
        (shift) => !shift.isPriority && matchesShiftSearch(shift, search),
      ),
      nowMs,
    ),
  }
}

function personName(
  person: { firstName: string; lastName: string; isMe: boolean },
  full: boolean,
): string {
  if (person.isMe) return 'Vos'
  return full
    ? `${person.firstName} ${person.lastName}`.trim()
    : person.firstName
}

/**
 * Quién supervisa o ya supervisó el turno, para que no se pisen (CJ-25):
 * «Supervisando: Ana» y/o «Supervisó: Luis». Vacío si nadie lo tomó.
 */
export function supervisorsLabels(shift: TodayShift, full = false): string[] {
  const active = shift.supervisors.filter(
    (s) => s.status === 'in_progress' && s.checkOutAt == null,
  )
  const done = shift.supervisors.filter((s) => !active.includes(s))
  const labels: string[] = []
  if (active.length > 0) {
    labels.push(
      `Supervisando: ${active.map((s) => personName(s, full)).join(', ')}`,
    )
  }
  if (done.length > 0) {
    labels.push(`Supervisó: ${done.map((s) => personName(s, full)).join(', ')}`)
  }
  return labels
}

export const SHIFT_STATE_LABELS: Record<TodayShift['displayState'], string> = {
  in_progress: 'En curso',
  pending: 'Por empezar',
  finished: 'Terminado',
}

/**
 * Por qué no puede tocar «Supervisar» (CJ-07, CJ-08, CJ-27), o `null` si puede.
 * La base vuelve a validar todo (`take_supervision`); esto evita el viaje y
 * deja el motivo a la vista. `workday` en `undefined` = todavía cargando.
 */
export function takeSupervisionBlock(
  shift: TodayShift,
  workday: MyWorkday | null | undefined,
): string | null {
  if (workday === undefined) return 'Cargando tu jornada…'
  if (shift.mySupervisionId != null) {
    return shift.mySupervisionStatus === 'in_progress'
      ? 'Ya estás supervisando este turno.'
      : 'Ya supervisaste este turno.'
  }
  if (workday === null) return 'Iniciá tu jornada para poder supervisar.'
  if (workday.state === 'ended') {
    return 'Tu jornada está finalizada: reabrila para poder supervisar.'
  }
  if (workday.state === 'paused') {
    return 'Estás en pausa: reanudá tu jornada para poder supervisar.'
  }
  if (openSupervisionOf(workday)) {
    return 'Cerrá o descartá tu supervisión abierta antes de empezar otra.'
  }
  return null
}
