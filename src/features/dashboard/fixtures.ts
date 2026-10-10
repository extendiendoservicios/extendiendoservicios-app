import type { AttendanceBoardRow } from '@/api/attendance'
import type { ShiftListRow } from '@/api/shifts'

/**
 * Fixtures de los tests del tablero. Todo anclado a un día fijo (30 sep 2026,
 * hora de Argentina, UTC-3) y a un `NOW` fijo: nada depende del reloj real.
 */
export const FIXTURE_DAY = '2026-09-30'
/** 11:00 en Buenos Aires. */
export const NOW = new Date('2026-09-30T11:00:00-03:00')

export function at(time: string): string {
  return `${FIXTURE_DAY}T${time}:00-03:00`
}

export function makeShift(overrides: Partial<ShiftListRow> = {}): ShiftListRow {
  return {
    id: 's1',
    clientId: 'c1',
    clientName: 'Cliente Uno',
    siteId: 'site1',
    siteName: 'Sede Uno',
    siteCity: null,
    shiftDate: FIXTURE_DAY,
    startTime: '08:00:00',
    endTime: '12:00:00',
    requiredStaff: 1,
    status: 'assigned',
    displayStatus: 'assigned',
    assignedCount: 1,
    presentCount: 0,
    finishedCount: 0,
    absentCount: 0,
    delayedCount: 0,
    openEnded: false,
    noCheckoutCount: 0,
    generated: false,
    notes: null,
    ...overrides,
  }
}

export function makeAssignment(
  overrides: Partial<AttendanceBoardRow> = {},
): AttendanceBoardRow {
  return {
    id: 'a1',
    shiftId: 's1',
    shiftDate: FIXTURE_DAY,
    shiftStatus: 'assigned',
    clientId: 'c1',
    clientName: 'Cliente Uno',
    siteId: 'site1',
    siteName: 'Sede Uno',
    employeeId: 'e1',
    employeeFirstName: 'Ana',
    employeeLastName: 'Gómez',
    employeeAvatarPath: null,
    startTime: '08:00:00',
    endTime: '12:00:00',
    openEnded: false,
    startsAt: at('08:00'),
    endsAt: at('12:00'),
    status: 'expected',
    displayStatus: 'expected',
    notes: null,
    checkInAt: null,
    checkOutAt: null,
    checkInSource: null,
    checkInRecordedBy: null,
    checkOutSource: null,
    checkOutRecordedBy: null,
    minutesLate: null,
    minutesEarlyLeave: null,
    lastNoticeKind: null,
    lastNoticeMinutesLate: null,
    lastNoticeReasonCode: null,
    lastNoticeReasonText: null,
    lastNoticeReportedBy: null,
    lastNoticeSource: null,
    lastNoticeAt: null,
    lastNoticeEstimatedArrivalAt: null,
    plannedMinutes: 240,
    workedMinutes: null,
    ...overrides,
  }
}
