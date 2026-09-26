import { describe, expect, it } from 'vitest'
import { pickFeatured } from './TodayPage'
import type { MyDayAssignment } from '@/api/myDay'

/**
 * `pickFeatured` (EMP-03, MOB-EMP-002): la tarjeta destacada de Hoy. Solo la
 * lógica, sin montar la pantalla (ver la nota de "Tests" en
 * `Docs/design-system.md`, sección de este paquete).
 */
function assignment(overrides: Partial<MyDayAssignment>): MyDayAssignment {
  return {
    assignmentId: 'a1',
    shiftId: 'sh1',
    shiftDate: '2026-09-26',
    isToday: true,
    clientId: 'c1',
    clientName: 'Limpia Ya',
    siteId: 'si1',
    siteName: 'Sede Centro',
    siteAddress: null,
    siteContactName: null,
    siteContactPhone: null,
    accessInstructions: null,
    buildingHours: null,
    phoneRestricted: false,
    photosNotAllowed: false,
    restrictionsNotes: null,
    startTime: '08:00:00',
    endTime: '12:00:00',
    startsAt: null,
    endsAt: null,
    status: 'expected',
    shiftStatus: 'scheduled',
    notes: null,
    tasksTotal: 0,
    tasksDone: 0,
    changedSinceLastSeen: false,
    checkInAt: null,
    checkOutAt: null,
    ...overrides,
  }
}

describe('pickFeatured', () => {
  it('devuelve undefined sin servicios hoy', () => {
    expect(pickFeatured([])).toBeUndefined()
  })

  it('prioriza el servicio en curso (inicio registrado, sin fin)', () => {
    const pending = assignment({
      assignmentId: 'pendiente',
      status: 'expected',
    })
    const inProgress = assignment({
      assignmentId: 'en-curso',
      status: 'present',
      checkInAt: '2026-09-26T11:00:00Z',
      checkOutAt: null,
    })
    expect(pickFeatured([pending, inProgress])?.assignmentId).toBe('en-curso')
  })

  it('sin ninguno en curso, el primer pendiente (sin inicio) que no sea ausencia avisada', () => {
    const absence = assignment({
      assignmentId: 'ausente',
      status: 'absence_notified',
    })
    const pending = assignment({
      assignmentId: 'pendiente',
      status: 'expected',
    })
    expect(pickFeatured([absence, pending])?.assignmentId).toBe('pendiente')
  })

  it('si ya están todos cerrados, el último de la lista', () => {
    const finished1 = assignment({
      assignmentId: 'finalizado-1',
      status: 'finished',
      checkInAt: '2026-09-26T11:00:00Z',
      checkOutAt: '2026-09-26T15:00:00Z',
    })
    const finished2 = assignment({
      assignmentId: 'finalizado-2',
      status: 'finished',
      checkInAt: '2026-09-26T16:00:00Z',
      checkOutAt: '2026-09-26T20:00:00Z',
    })
    expect(pickFeatured([finished1, finished2])?.assignmentId).toBe(
      'finalizado-2',
    )
  })
})
