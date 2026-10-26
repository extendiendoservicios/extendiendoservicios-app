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
 * Ancla del contador: los segundos netos que se mostraban en el instante
 * `atMs` (reloj del dispositivo, solo para medir diferencias) y si la jornada
 * estaba en marcha.
 */
export interface WorkdayCounterAnchor {
  seconds: number
  atMs: number
  running: boolean
}

/** Retroceso (en segundos) a partir del cual manda el servidor, p. ej. por una corrección. */
const ANCHOR_BACKWARD_TOLERANCE_SECONDS = 120

/** Segundos netos que muestra el ancla en `nowMs`. En pausa o finalizada no avanza. */
export function anchorSecondsAt(
  anchor: WorkdayCounterAnchor,
  nowMs: number,
): number {
  if (!anchor.running) return anchor.seconds
  return anchor.seconds + Math.max(0, Math.floor((nowMs - anchor.atMs) / 1000))
}

/**
 * Ancla nueva cuando llega una lectura del servidor (`readAtMs` es el instante
 * de esa lectura en el reloj del dispositivo). El servidor informa minutos
 * enteros (hasta 59 s menos que los reales), así que:
 * - sin ancla previa, o si la jornada cambió entre en marcha y no en marcha,
 *   se parte de `workedMinutes * 60`;
 * - si lo que ya se mostraba es menor, se adelanta al valor del servidor;
 * - si lo que se mostraba es mayor por menos de dos minutos, se conserva (el
 *   contador nunca retrocede por el redondeo a minutos);
 * - si lo que se mostraba es mayor por dos minutos o más, manda el servidor
 *   (una corrección de la administración, por ejemplo).
 * Nunca se usa la hora absoluta del teléfono, solo diferencias entre lecturas.
 */
export function nextCounterAnchor(
  previous: WorkdayCounterAnchor | null,
  workday: MyWorkday,
  readAtMs: number,
): WorkdayCounterAnchor {
  const running = workday.state === 'running'
  const fromServer: WorkdayCounterAnchor = {
    seconds: workday.workedMinutes * 60,
    atMs: readAtMs,
    running,
  }
  if (!previous || !previous.running || !running) return fromServer
  const shown = anchorSecondsAt(previous, readAtMs)
  if (
    shown >= fromServer.seconds &&
    shown - fromServer.seconds < ANCHOR_BACKWARD_TOLERANCE_SECONDS
  ) {
    return { seconds: shown, atMs: readAtMs, running }
  }
  return fromServer
}

/** Reloj `H:MM:SS` para el contador de la jornada. */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** La pausa abierta (en curso) de la jornada, si está en pausa. */
export function currentPause(workday: MyWorkday) {
  if (workday.state !== 'paused') return null
  return (
    [...workday.pauses].reverse().find((pause) => pause.endsAt == null) ?? null
  )
}
