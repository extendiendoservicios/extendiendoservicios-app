import type { AttendanceBoardRow } from '@/api/attendance'
import type { ShiftListRow } from '@/api/shifts'
import { shiftStartInstant } from './kpis'

/**
 * Bloque "Requiere atención" (DASH-002, `05` línea 36): las cuatro categorías
 * como funciones puras sobre `v_shifts_board` y `v_assignments_board`.
 *
 * - `absence`: asignación con ausencia avisada (turno vivo, sin terminar).
 * - `uncovered`: turno sin cubrir (`display_status = uncovered`). Si el hueco
 *   lo dejó una ausencia avisada, el turno ya aparece por la categoría
 *   `absence` (que ofrece "Asignar reemplazo" sobre ese mismo turno), así que
 *   no se duplica.
 * - `noRecord`: sin registro pasada la hora de inicio.
 * - `noCheckout` (AJ2-10): «Sin salida», turno «A terminar» que pasó el día
 *   sin fichaje de salida; suma 0 horas hasta que administración cargue la
 *   hora. No se trata como un fin pasado común (`overdue`).
 * - `overdue`: en curso pasada la hora de fin sin fin registrado.
 * - `outsideGeo` (B-21): algún fichaje de hoy quedó «Fuera de zona» y la
 *   administración no lo marcó como válido (`has_outside_geo` de
 *   `v_assignments_board`). Es independiente de las demás: una asignación
 *   puede tener este aviso y además otro (por ejemplo, sigue en curso pasada
 *   su hora de fin).
 * - `late` (AJ-07): llegada tarde (pasó el inicio hace hasta 15 min, sin
 *   registro). Es una alerta amarilla y va última. `on_the_way` (AJ-02) no
 *   entra: es informativo y no negativo.
 * - `delayNotified` (OG-03): el empleado avisó que llega tarde y todavía no
 *   fichó el inicio. Es amarilla y se mantiene hasta la hora estimada (inicio
 *   más los minutos avisados); pasada esa hora se reemplaza por «no registró
 *   el inicio» (o «llegó tarde») como hoy.
 *
 * Cerrar un aviso (OG-02): `applyDismissals` separa los abiertos de los
 * cerrados. El cierre vale para una situación (tipo, turno y asignación).
 */
export type AttentionKind =
  | 'absence'
  | 'uncovered'
  | 'noRecord'
  | 'noCheckout'
  | 'overdue'
  | 'outsideGeo'
  | 'late'
  | 'delayNotified'

export const ATTENTION_ORDER: AttentionKind[] = [
  'noRecord',
  'noCheckout',
  'overdue',
  'absence',
  'uncovered',
  'outsideGeo',
  'late',
  'delayNotified',
]

export interface AttentionItem {
  kind: AttentionKind
  /** Clave estable para React. */
  key: string
  shiftId: string
  /** Presente en todos salvo `uncovered`. */
  assignment?: AttendanceBoardRow
  /** Turno de `v_shifts_board`, si está cargado (para "Asignar reemplazo"). */
  shift?: ShiftListRow
  /** Minutos desde la hora de referencia (inicio o fin); `null` si no aplica. */
  minutesSince: number | null
}

function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000))
}

/**
 * OG-03: demora avisada vigente. El estado es «Demora avisada», todavía no
 * hay fichaje de inicio y no pasó la hora estimada (inicio de la franja más
 * los minutos avisados). Sin minutos o sin inicio no se puede estimar: no
 * entra y queda como hoy.
 */
function isDelayNoticeOpen(row: AttendanceBoardRow, now: Date): boolean {
  if (
    row.status !== 'delay_notified' ||
    row.checkInAt != null ||
    row.lastNoticeKind !== 'delay' ||
    row.lastNoticeMinutesLate == null ||
    row.startsAt == null
  ) {
    return false
  }
  const estimated =
    new Date(row.startsAt).getTime() + row.lastNoticeMinutesLate * 60_000
  return now.getTime() <= estimated
}

/** Una fila de `attention_dismissals` (OG-02), ya en camelCase. */
export interface AttentionDismissal {
  id: string
  kind: string
  shiftId: string
  assignmentId: string | null
  dismissedBy: string
  dismissedAt: string
}

/** Identidad de una situación: tipo, turno y asignación (o vacío en «Turno sin cubrir»). */
export function attentionSituationKey(
  kind: string,
  shiftId: string,
  assignmentId: string | null | undefined,
): string {
  return `${kind}|${shiftId}|${assignmentId ?? ''}`
}

export function attentionItemSituationKey(item: AttentionItem): string {
  return attentionSituationKey(item.kind, item.shiftId, item.assignment?.id)
}

export interface ClosedAttentionItem {
  item: AttentionItem
  dismissal: AttentionDismissal
}

/**
 * OG-02: separa los avisos abiertos de los cerrados. Solo cuenta un cierre si
 * la situación sigue ocurriendo; si la misma asignación pasa a otro tipo de
 * aviso, ese aparece abierto porque su clave es distinta.
 */
export function applyDismissals(
  items: AttentionItem[],
  dismissals: AttentionDismissal[],
): { open: AttentionItem[]; closed: ClosedAttentionItem[] } {
  const bySituation = new Map(
    dismissals.map((dismissal) => [
      attentionSituationKey(
        dismissal.kind,
        dismissal.shiftId,
        dismissal.assignmentId,
      ),
      dismissal,
    ]),
  )
  const open: AttentionItem[] = []
  const closed: ClosedAttentionItem[] = []
  for (const item of items) {
    const dismissal = bySituation.get(attentionItemSituationKey(item))
    if (dismissal) {
      closed.push({ item, dismissal })
    } else {
      open.push(item)
    }
  }
  return { open, closed }
}

export function computeAttention(
  shifts: ShiftListRow[],
  assignments: AttendanceBoardRow[],
  now: Date,
): AttentionItem[] {
  const shiftById = new Map(shifts.map((shift) => [shift.id, shift]))
  const live = assignments.filter(
    (row) => row.shiftStatus !== 'cancelled' && row.shiftStatus !== 'completed',
  )
  const items: AttentionItem[] = []

  for (const row of live) {
    if (row.status === 'absence_notified') {
      items.push({
        kind: 'absence',
        key: `absence-${row.id}`,
        shiftId: row.shiftId,
        assignment: row,
        shift: shiftById.get(row.shiftId),
        minutesSince: null,
      })
    } else if (isDelayNoticeOpen(row, now)) {
      items.push({
        kind: 'delayNotified',
        key: `delayNotified-${row.id}`,
        shiftId: row.shiftId,
        assignment: row,
        shift: shiftById.get(row.shiftId),
        minutesSince: row.lastNoticeAt
          ? minutesBetween(new Date(row.lastNoticeAt), now)
          : null,
      })
    } else if (row.displayStatus === 'late') {
      items.push({
        kind: 'late',
        key: `late-${row.id}`,
        shiftId: row.shiftId,
        assignment: row,
        shift: shiftById.get(row.shiftId),
        minutesSince: row.startsAt
          ? minutesBetween(new Date(row.startsAt), now)
          : null,
      })
    } else if (row.displayStatus === 'no_record') {
      items.push({
        kind: 'noRecord',
        key: `noRecord-${row.id}`,
        shiftId: row.shiftId,
        assignment: row,
        shift: shiftById.get(row.shiftId),
        minutesSince: row.startsAt
          ? minutesBetween(new Date(row.startsAt), now)
          : null,
      })
    } else if (row.displayStatus === 'no_checkout') {
      items.push({
        kind: 'noCheckout',
        key: `noCheckout-${row.id}`,
        shiftId: row.shiftId,
        assignment: row,
        shift: shiftById.get(row.shiftId),
        minutesSince: row.endsAt
          ? minutesBetween(new Date(row.endsAt), now)
          : null,
      })
    } else if (
      row.status === 'present' &&
      row.checkOutAt == null &&
      row.endsAt != null &&
      new Date(row.endsAt) < now
    ) {
      items.push({
        kind: 'overdue',
        key: `overdue-${row.id}`,
        shiftId: row.shiftId,
        assignment: row,
        shift: shiftById.get(row.shiftId),
        minutesSince: minutesBetween(new Date(row.endsAt), now),
      })
    }
  }

  // B-21: «Fuera de zona» de hoy. Cuenta también turnos ya terminados, pero no
  // los cancelados.
  for (const row of assignments) {
    if (row.hasOutsideGeo && row.shiftStatus !== 'cancelled') {
      items.push({
        kind: 'outsideGeo',
        key: `outsideGeo-${row.id}`,
        shiftId: row.shiftId,
        assignment: row,
        shift: shiftById.get(row.shiftId),
        minutesSince: null,
      })
    }
  }

  const shiftsWithAbsence = new Set(
    items.filter((item) => item.kind === 'absence').map((i) => i.shiftId),
  )
  for (const shift of shifts) {
    if (
      shift.displayStatus === 'uncovered' &&
      !shiftsWithAbsence.has(shift.id)
    ) {
      items.push({
        kind: 'uncovered',
        key: `uncovered-${shift.id}`,
        shiftId: shift.id,
        shift,
        minutesSince: minutesBetween(
          shiftStartInstant(shift.shiftDate, shift.startTime),
          now,
        ),
      })
    }
  }

  return items.sort((a, b) => {
    const byKind =
      ATTENTION_ORDER.indexOf(a.kind) - ATTENTION_ORDER.indexOf(b.kind)
    if (byKind !== 0) {
      return byKind
    }
    return (b.minutesSince ?? 0) - (a.minutesSince ?? 0)
  })
}
