import type { MyWorkday, WorkdaySupervision } from '@/api/myWorkdays'
import type { MySupervision } from '@/api/mySupervisions'
import type { TodayShift } from '@/api/supervisorToday'

/**
 * Datos de prueba de la jornada y de los turnos del coordinador (P24.2). Solo
 * los usan los tests; viven acá para no repetirlos en cada archivo.
 */
export function makeWorkday(overrides: Partial<MyWorkday> = {}): MyWorkday {
  return {
    id: 'wd1',
    workDate: '2026-10-23',
    state: 'running',
    startedAt: '2026-10-23T11:00:00Z',
    endedAt: null,
    workedMinutes: 125,
    pauseMinutes: 0,
    autoClosed: false,
    autoCloseWarning: false,
    corrected: false,
    pauses: [],
    supervisions: [],
    supervisionsCount: 0,
    events: [],
    ...overrides,
  }
}

export function makeWorkdaySupervision(
  overrides: Partial<WorkdaySupervision> = {},
): WorkdaySupervision {
  return {
    supervisionId: 'sv1',
    shiftId: 'sh1',
    clientName: 'Limpiadora SRL',
    siteName: 'Sede Centro',
    status: 'in_progress',
    checkInAt: '2026-10-23T12:00:00Z',
    checkOutAt: null,
    durationMinutes: 20,
    unclosed: false,
    ...overrides,
  }
}

export function makeTodayShift(
  overrides: Partial<TodayShift> = {},
): TodayShift {
  return {
    shiftId: 'sh1',
    shiftDate: '2026-10-23',
    startTime: '08:00:00',
    endTime: '12:00:00',
    startsAt: '2026-10-23T11:00:00Z',
    endsAt: '2026-10-23T15:00:00Z',
    openEnded: false,
    displayState: 'pending',
    requiredStaff: 1,
    clientId: 'c1',
    clientName: 'Limpiadora SRL',
    siteId: 'si1',
    siteName: 'Sede Centro',
    siteAddress: 'Av. Siempre Viva 123',
    siteCity: 'Tigre',
    siteLatitude: null,
    siteLongitude: null,
    isPriority: false,
    assignedEmployees: [],
    supervisors: [],
    mySupervisionId: null,
    mySupervisionStatus: null,
    ...overrides,
  }
}

/** Una supervisión propia en curso, con un empleado que ya inició (para SUP-04 y SUP-06). */
export function makeMySupervision(
  overrides: Partial<MySupervision> = {},
): MySupervision {
  return {
    id: 'sv1',
    shiftId: 'sh1',
    shiftDate: '2026-10-23',
    isToday: true,
    clientId: 'c1',
    clientName: 'Limpiadora SRL',
    siteId: 'si1',
    siteName: 'Sede Centro',
    siteAddress: 'Av. Siempre Viva 123',
    siteCity: 'San Isidro',
    siteLatitude: -34.47,
    siteLongitude: -58.5,
    siteContactName: null,
    siteContactPhone: null,
    accessInstructions: null,
    buildingHours: null,
    phoneRestricted: false,
    photosNotAllowed: false,
    requiresPhotos: false,
    myPhotosCount: 0,
    myVideosCount: 0,
    restrictionsNotes: null,
    startTime: '08:00:00',
    endTime: '12:00:00',
    startsAt: null,
    endsAt: '2030-01-01T12:00:00Z',
    shiftOpenEnded: false,
    status: 'in_progress',
    assignedAt: '2026-10-23T10:00:00Z',
    notDoneReason: null,
    cancelReason: null,
    generalNotes: null,
    criteriaSnapshot: null,
    checkInAt: '2026-10-23T11:00:00Z',
    checkOutAt: null,
    siteGeofenceRadiusM: 150,
    geofenceMaxAccuracyM: 150,
    checkInGeo: null,
    checkOutGeo: null,
    assignedEmployees: [
      {
        employeeId: 'e1',
        firstName: 'Ana',
        lastName: 'Gómez',
        status: 'present',
        checkInAt: '2026-10-23T11:05:00Z',
      },
    ],
    ...overrides,
  }
}
