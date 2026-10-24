import type { SupervisorStatusRow } from '@/api/supervisorStatus'
import type { AdminWorkday, WorkdaySupervision } from '@/api/workdaysAdmin'

/** Filas de ejemplo de `v_supervisor_status` y de `v_supervisor_workdays_admin` para los tests. */
export function makeStatusRow(
  overrides: Partial<SupervisorStatusRow> = {},
): SupervisorStatusRow {
  return {
    supervisorId: 'sv1',
    firstName: 'Sofía',
    lastName: 'Ruiz',
    status: 'in_activity',
    workdayId: 'w1',
    workDate: '2026-10-23',
    startedAt: '2026-10-23T11:00:00Z',
    endedAt: null,
    lastEventAt: '2026-10-23T12:30:00Z',
    latitude: -34.6037,
    longitude: -58.3816,
    accuracyM: 15,
    workedMinutes: 90,
    pauseReason: null,
    supervisionId: null,
    clientId: null,
    clientName: null,
    siteId: null,
    siteName: null,
    autoClosed: false,
    corrected: false,
    onLeave: false,
    ...overrides,
  }
}

export function makeWorkdaySupervision(
  overrides: Partial<WorkdaySupervision> = {},
): WorkdaySupervision {
  return {
    supervisionId: 'sup1',
    shiftId: 's1',
    clientId: 'c1',
    clientName: 'Logística Central',
    siteId: 'st1',
    siteName: 'Munro',
    status: 'completed',
    checkInAt: '2026-10-21T13:00:00Z',
    checkOutAt: '2026-10-21T13:45:00Z',
    durationMinutes: 45,
    unclosed: false,
    ...overrides,
  }
}

/** Jornada del 21/10 de 08:00 a 17:00 (hora de Argentina) con una pausa de 30 min: 8 h 30 min netas. */
export function makeWorkday(
  overrides: Partial<AdminWorkday> = {},
): AdminWorkday {
  return {
    id: 'w1',
    supervisorId: 'sv1',
    supervisorName: 'Sofía Ruiz',
    workDate: '2026-10-21',
    startedAt: '2026-10-21T11:00:00Z',
    endedAt: '2026-10-21T20:00:00Z',
    state: 'ended',
    workedMinutes: 510,
    pauseMinutes: 30,
    autoClosed: false,
    corrected: false,
    autoCloseWarning: false,
    pauses: [
      {
        type: 'pause',
        pauseEventId: 'e-pause',
        resumeEventId: 'e-resume',
        startsAt: '2026-10-21T15:00:00Z',
        endsAt: '2026-10-21T15:30:00Z',
        minutes: 30,
        reason: 'Almuerzo',
        corrected: false,
      },
    ],
    supervisions: [makeWorkdaySupervision()],
    supervisionsCount: 1,
    events: [],
    ...overrides,
  }
}
