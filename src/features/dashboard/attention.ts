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
 *   registro). Es una alerta amarilla.
 * - `onTheWay` (P32, D-09/D-10): el empleado avisó «En camino» y todavía no
 *   fichó el inicio. Con `tone: 'ok'` (verde, informativo) si la hora estimada
 *   es anterior o igual al inicio del turno, o si no avisó hora; deja de
 *   mostrarse pasada la hora de inicio y siguen las alertas de siempre. Con
 *   `tone: 'warn'` (amarilla) si la hora estimada es posterior al inicio:
 *   sigue hasta esa hora, igual que `delayNotified`. Las verdes van al final
 *   y no cuentan como alerta negativa (`isNegativeAttention`).
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
  | 'onTheWay'

export const ATTENTION_ORDER: AttentionKind[] = [
  'noRecord',
  'noCheckout',
  'overdue',
  'absence',
  'uncovered',
  'outsideGeo',
  'late',
  'delayNotified',
  'onTheWay',
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
  /** Solo `onTheWay`: `ok` (verde, informativo) o `warn` (amarilla, llega después del inicio). */
  tone?: 'ok' | 'warn'
  /** Solo `onTheWay`: hora estimada de llegada avisada (ISO), si la hay. */
  estimatedArrivalAt?: string | null
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

/**
 * D-09/D-10: «En camino» vigente, sin fichaje de inicio. `warn` (amarilla) si
 * la hora estimada es posterior al inicio y todavía no pasó; `ok` (verde) si
 * es anterior o igual al inicio, o no hay hora estimada, y todavía no pasó el
 * inicio; `null` si no corresponde mostrarlo.
 */
function onTheWayTone(
  row: AttendanceBoardRow,
  now: Date,
): 'ok' | 'warn' | null {
  if (
    row.lastNoticeKind !== 'on_the_way' ||
    row.checkInAt != null ||
    row.startsAt == null
  ) {
    return null
  }
  const start = new Date(row.startsAt).getTime()
  const estimated =
    row.lastNoticeEstimatedArrivalAt != null
      ? new Date(row.lastNoticeEstimatedArrivalAt).getTime()
      : null
  if (estimated != null && estimated > start) {
    return now.getTime() <= estimated ? 'warn' : null
  }
  return now.getTime() <= start ? 'ok' : null
}

/** Las alertas verdes de «En camino» son informativas: no suman a contadores de alertas. */
export function isNegativeAttention(item: AttentionItem): boolean {
  return !(item.kind === 'onTheWay' && item.tone === 'ok')
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
    } else if (onTheWayTone(row, now) === 'warn') {
      items.push({
        kind: 'onTheWay',
        key: `onTheWay-${row.id}`,
        shiftId: row.shiftId,
        assignment: row,
        shift: shiftById.get(row.shiftId),
        tone: 'warn',
        estimatedArrivalAt: row.lastNoticeEstimatedArrivalAt,
        minutesSince: null,
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
    } else if (onTheWayTone(row, now) === 'ok') {
      items.push({
        kind: 'onTheWay',
        key: `onTheWay-${row.id}`,
        shiftId: row.shiftId,
        assignment: row,
        shift: shiftById.get(row.shiftId),
        tone: 'ok',
        estimatedArrivalAt: row.lastNoticeEstimatedArrivalAt,
        minutesSince: null,
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

  // Las amarillas de «En camino» van junto a `late`/`delayNotified`; las verdes, al final.
  const rank = (item: AttentionItem) =>
    item.kind === 'onTheWay' && item.tone === 'warn'
      ? ATTENTION_ORDER.indexOf('delayNotified') + 0.5
      : ATTENTION_ORDER.indexOf(item.kind)

  return items.sort((a, b) => {
    const byKind = rank(a) - rank(b)
    if (byKind !== 0) {
      return byKind
    }
    return (b.minutesSince ?? 0) - (a.minutesSince ?? 0)
  })
}
