import type {
  MyWorkday,
  WorkdayAction,
  WorkdaySupervision,
} from '@/api/myWorkdays'

/**
 * Lógica pura de la barra de jornada (P24.2, CJ-12 a CJ-17, CJ-29, CJ-30), sin
 * React: qué estado mostrar, qué botones corresponden y cómo se extrapola el
 * contador de horas netas entre dos lecturas.
 */

export type WorkdayBarState =
  'not_started' | 'active' | 'supervising' | 'paused' | 'ended' | 'auto_closed'

/** La supervisión abierta de la jornada (iniciada, sin fin registrado), si hay. */
export function openSupervisionOf(
  workday: MyWorkday | null | undefined,
): WorkdaySupervision | null {
  return (
    workday?.supervisions.find(
      (supervision) =>
        supervision.status === 'in_progress' && supervision.checkOutAt == null,
    ) ?? null
  )
}

/**
 * Los seis aspectos de la barra: sin iniciar, en actividad (entre sedes),
 * supervisando, en pausa, finalizada y cerrada automáticamente (CJ-31). Una
 * jornada cerrada sola que la administración ya corrigió se ve como finalizada.
 */
export function workdayBarState(
  workday: MyWorkday | null | undefined,
): WorkdayBarState {
  if (!workday) return 'not_started'
  if (workday.state === 'ended') {
    return workday.autoCloseWarning ? 'auto_closed' : 'ended'
  }
  if (workday.state === 'paused') return 'paused'
  return openSupervisionOf(workday) ? 'supervising' : 'active'
}

export const WORKDAY_BAR_LABELS: Record<WorkdayBarState, string> = {
  not_started: 'Sin iniciar',
  active: 'En actividad',
  supervising: 'Supervisando',
  paused: 'En pausa',
  ended: 'Finalizada',
  auto_closed: 'Cerrada automáticamente',
}

export const WORKDAY_BAR_VARIANTS: Record<
  WorkdayBarState,
  'neutral' | 'primary' | 'info' | 'warning' | 'success'
> = {
  not_started: 'neutral',
  active: 'primary',
  supervising: 'info',
  paused: 'warning',
  ended: 'success',
  auto_closed: 'warning',
}

/**
 * Botones que corresponden a cada estado. Con una supervisión abierta no se
 * puede pausar ni finalizar (CJ-29): los botones se muestran deshabilitados con
 * su motivo, por eso `supervising` los lista igual (ver `workdayActionBlock`).
 */
export function availableWorkdayActions(
  state: WorkdayBarState,
): WorkdayAction[] {
  switch (state) {
    case 'not_started':
      return ['start']
    case 'active':
    case 'supervising':
      return ['pause', 'end']
    case 'paused':
      return ['resume', 'end']
    case 'ended':
    case 'auto_closed':
      return ['reopen']
  }
}

/** Motivo por el que un botón de la barra está deshabilitado (CJ-29), o `null` si se puede. */
export function workdayActionBlock(
  state: WorkdayBarState,
  action: WorkdayAction,
): string | null {
  if (state === 'supervising' && (action === 'pause' || action === 'end')) {
    return 'Cerrá o descartá tu supervisión para poder pausar o finalizar la jornada.'
  }
  return null
}

export const WORKDAY_ACTION_LABELS: Record<WorkdayAction, string> = {
  start: 'Iniciar jornada',
  pause: 'Pausar',
  resume: 'Reanudar',
  end: 'Finalizar jornada',
  reopen: 'Reabrir jornada',
}

/**
 * Minutos netos para mostrar ahora. La base calcula `workedMinutes` al momento
 * de la lectura; mientras la jornada está en marcha, se le suma lo que pasó
 * desde esa lectura. Solo se usa la diferencia entre dos relojes del
 * dispositivo (nunca la hora absoluta del teléfono), y cada lectura nueva
 * (cada 30 s) vuelve a anclar el valor a lo que dice el servidor. En pausa o
 * finalizada el valor no avanza.
 */
export function liveWorkedMinutes(
  workday: MyWorkday,
  fetchedAtMs: number,
  nowMs: number,
): number {
  if (workday.state !== 'running') return workday.workedMinutes
  const elapsedMin = Math.max(0, Math.floor((nowMs - fetchedAtMs) / 60_000))
  return workday.workedMinutes + elapsedMin
}

/** La pausa abierta (en curso) de la jornada, si está en pausa. */
export function currentPause(workday: MyWorkday) {
  if (workday.state !== 'paused') return null
  return (
    [...workday.pauses].reverse().find((pause) => pause.endsAt == null) ?? null
  )
}
