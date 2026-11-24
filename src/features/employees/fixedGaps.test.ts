import { describe, expect, it } from 'vitest'
import type { FixedGap, FixedGapReason } from '@/api/employeeFixed'
import { canAssignGap, describeGap, groupGapsByDate } from './fixedGaps'

function gap(over: Partial<FixedGap> = {}): FixedGap {
  return {
    shiftId: 's1',
    shiftDate: '2026-11-10',
    startTime: '08:00:00',
    endTime: '12:00:00',
    openEnded: false,
    clientId: 'c1',
    clientName: 'Cliente',
    siteId: 'si1',
    siteName: 'Sede Central',
    serviceId: 'sv1',
    serviceName: 'Limpieza',
    calendarColor: 1,
    reason: 'NOT_ASSIGNED',
    detail: null,
    shiftStatus: 'scheduled',
    ...over,
  }
}

describe('describeGap', () => {
  const texts: Record<Exclude<FixedGapReason, 'OVERLAP'>, string> = {
    ON_LEAVE: 'De licencia',
    REMOVED: 'Quitado a mano',
    ADDED_AFTER: 'Fijo agregado después de generar',
    NOT_ASSIGNED: 'Sin asignar',
  }
  for (const [reason, text] of Object.entries(texts)) {
    it(`${reason} → «${text}»`, () => {
      expect(describeGap(gap({ reason: reason as FixedGapReason }))).toEqual({
        text,
        conflictShiftId: null,
      })
    })
  }

  it('OVERLAP nombra la sede y el horario del choque y guarda el turno para el enlace', () => {
    const description = describeGap(
      gap({
        reason: 'OVERLAP',
        detail: {
          conflictShiftId: 'sx',
          conflictAssignmentId: null,
          clientName: 'Otro',
          siteId: null,
          siteName: 'Sede Norte',
          serviceId: null,
          serviceName: null,
          shiftDate: '2026-11-10',
          startTime: '09:00:00',
          endTime: '13:00:00',
          openEnded: false,
          leaves: [],
          status: null,
          assigned: [],
        },
      }),
    )
    expect(description).toEqual({
      text: 'Se superpone con Sede Norte 09:00–13:00',
      conflictShiftId: 'sx',
    })
  })

  it('OVERLAP sin detalle no se rompe', () => {
    expect(describeGap(gap({ reason: 'OVERLAP' }))).toEqual({
      text: 'Se superpone con otro turno',
      conflictShiftId: null,
    })
  })
})

describe('canAssignGap', () => {
  it('permite asignar solo cuando el motivo no lo impide', () => {
    expect(canAssignGap({ reason: 'REMOVED' })).toBe(true)
    expect(canAssignGap({ reason: 'ADDED_AFTER' })).toBe(true)
    expect(canAssignGap({ reason: 'NOT_ASSIGNED' })).toBe(true)
    expect(canAssignGap({ reason: 'ON_LEAVE' })).toBe(false)
    expect(canAssignGap({ reason: 'OVERLAP' })).toBe(false)
  })
})

describe('groupGapsByDate', () => {
  it('agrupa por día y ordena por horario', () => {
    const grouped = groupGapsByDate([
      gap({ shiftId: 'b', startTime: '14:00:00' }),
      gap({ shiftId: 'a', startTime: '08:00:00' }),
      gap({ shiftId: 'c', shiftDate: '2026-11-11' }),
    ])
    expect(grouped.get('2026-11-10')?.map((g) => g.shiftId)).toEqual(['a', 'b'])
    expect(grouped.get('2026-11-11')).toHaveLength(1)
  })
})
