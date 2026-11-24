import type { FixedGap, FixedGapReason } from '@/api/employeeFixed'

/**
 * Fijos sin asignar del calendario del empleado (OH-06, P30.4b): lógica sin
 * React. Cada hueco es un turno de un servicio donde la persona es fija y no
 * quedó asignada; trae el motivo que calcula la base.
 */

/** Motivos que no impiden asignar a esta persona (la base igual vuelve a validar). */
const ASSIGNABLE_REASONS: readonly FixedGapReason[] = [
  'REMOVED',
  'ADDED_AFTER',
  'NOT_ASSIGNED',
]

export function canAssignGap(gap: Pick<FixedGap, 'reason'>): boolean {
  return ASSIGNABLE_REASONS.includes(gap.reason)
}

function hhmm(time: string | null): string {
  return time ? time.slice(0, 5) : ''
}

export interface GapDescription {
  /** Texto corto del motivo. */
  text: string
  /** Turno con el que se superpone (solo `OVERLAP`): para el enlace «Ver turno». */
  conflictShiftId: string | null
}

/** Texto del motivo de un hueco (OH-06). */
export function describeGap(
  gap: Pick<FixedGap, 'reason' | 'detail'>,
): GapDescription {
  switch (gap.reason) {
    case 'ON_LEAVE':
      return { text: 'De licencia', conflictShiftId: null }
    case 'OVERLAP': {
      const detail = gap.detail
      const site = detail?.siteName ?? ''
      const start = hhmm(detail?.startTime ?? null)
      const end = detail?.openEnded ? '' : hhmm(detail?.endTime ?? null)
      const schedule = start ? (end ? `${start}–${end}` : start) : ''
      const target = [site, schedule].filter(Boolean).join(' ')
      return {
        text: target
          ? `Se superpone con ${target}`
          : 'Se superpone con otro turno',
        conflictShiftId: detail?.conflictShiftId ?? null,
      }
    }
    case 'REMOVED':
      return { text: 'Quitado a mano', conflictShiftId: null }
    case 'ADDED_AFTER':
      return { text: 'Fijo agregado después de generar', conflictShiftId: null }
    default:
      return { text: 'Sin asignar', conflictShiftId: null }
  }
}

/** Agrupa los huecos por día (`YYYY-MM-DD`), ordenados por horario de inicio. */
export function groupGapsByDate(gaps: FixedGap[]): Map<string, FixedGap[]> {
  const byDate = new Map<string, FixedGap[]>()
  const sorted = [...gaps].sort(
    (a, b) =>
      a.shiftDate.localeCompare(b.shiftDate) ||
      a.startTime.localeCompare(b.startTime) ||
      a.shiftId.localeCompare(b.shiftId),
  )
  for (const gap of sorted) {
    const list = byDate.get(gap.shiftDate) ?? []
    list.push(gap)
    byDate.set(gap.shiftDate, list)
  }
  return byDate
}
