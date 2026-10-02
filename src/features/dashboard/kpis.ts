import { TZDate } from '@date-fns/tz'
import type { AttendanceBoardRow } from '@/api/attendance'
import type { ShiftListRow } from '@/api/shifts'
import { BUENOS_AIRES_TIME_ZONE } from '@/lib/format'

/**
 * Cálculo de los KPIs del tablero (DASH-001, ADM-02, `05` línea 36): funciones
 * puras sobre las filas que ya trae `src/api/shifts.ts` (`v_shifts_board`) y
 * `src/api/attendance.ts` (`v_assignments_board`), sin consultas propias.
 *
 * Todas reciben `now` por parámetro: así los tests no dependen de la hora en
 * que corren y la pantalla puede avanzar el reloj sola cada 30 s.
 */

/** Ventana de "próximos" (`04` sección 4, derivado `upcoming`): 2 horas. */
export const UPCOMING_WINDOW_MS = 2 * 60 * 60 * 1000

export interface DashboardKpis {
  /** Turnos de hoy que no están cancelados. */
  shiftsToday: number
  /** Clientes y sedes distintos de esos turnos (detalle de la tarjeta). */
  clientsToday: number
  sitesToday: number
  /** Asignaciones en `present` (con inicio y sin fin). */
  present: number
  /** Turnos que empiezan dentro de las próximas 2 h (todavía `scheduled` o `assigned`). */
  upcoming: number
  /** Asignaciones `expected`/`delay_notified` con la hora de inicio ya pasada (`display_status = no_record`). */
  noRecord: number
  /** Avisos vigentes de ausencia y de demora. */
  absenceNotices: number
  delayNotices: number
}

/** Instante de inicio de un turno a partir de su fecha y hora (hora de Argentina). */
export function shiftStartInstant(shiftDate: string, startTime: string): Date {
  const [year = 0, month = 1, day = 1] = shiftDate
    .slice(0, 10)
    .split('-')
    .map(Number)
  const [hours = 0, minutes = 0] = startTime.slice(0, 5).split(':').map(Number)
  return new TZDate(
    year,
    month - 1,
    day,
    hours,
    minutes,
    0,
    BUENOS_AIRES_TIME_ZONE,
  )
}

/** Un turno cancelado (o su asignación) no cuenta en ningún indicador. */
function isLiveShift(status: ShiftListRow['status']): boolean {
  return status !== 'cancelled'
}

export function isShiftUpcoming(shift: ShiftListRow, now: Date): boolean {
  if (shift.status !== 'scheduled' && shift.status !== 'assigned') {
    return false
  }
  const start = shiftStartInstant(shift.shiftDate, shift.startTime).getTime()
  return start > now.getTime() && start - now.getTime() <= UPCOMING_WINDOW_MS
}

export function computeKpis(
  shifts: ShiftListRow[],
  assignments: AttendanceBoardRow[],
  now: Date,
): DashboardKpis {
  const liveShifts = shifts.filter((shift) => isLiveShift(shift.status))
  const liveAssignments = assignments.filter((row) =>
    isLiveShift(row.shiftStatus),
  )

  return {
    shiftsToday: liveShifts.length,
    clientsToday: new Set(liveShifts.map((shift) => shift.clientId)).size,
    sitesToday: new Set(liveShifts.map((shift) => shift.siteId)).size,
    present: liveAssignments.filter((row) => row.status === 'present').length,
    upcoming: liveShifts.filter((shift) => isShiftUpcoming(shift, now)).length,
    noRecord: liveAssignments.filter((row) => row.displayStatus === 'no_record')
      .length,
    absenceNotices: liveAssignments.filter(
      (row) => row.status === 'absence_notified',
    ).length,
    delayNotices: liveAssignments.filter(
      (row) => row.status === 'delay_notified',
    ).length,
  }
}
