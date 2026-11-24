import { describe, expect, it } from 'vitest'
import type { FixedServiceSchedule } from '@/api/services'
import { findFixedOverlaps, schedulesOverlap } from './fixedOverlap'

const weekdays = [1, 2, 3, 4, 5]

function other(
  overrides: Partial<FixedServiceSchedule> = {},
): FixedServiceSchedule {
  return {
    employeeId: 'sofia',
    serviceId: 'temprano',
    serviceName: 'Limpieza temprano',
    weekdays,
    weeksOfMonth: null,
    startTime: '06:00:00',
    endTime: '10:00:00',
    openEnded: false,
    validFrom: '2026-01-01',
    validTo: null,
    ...overrides,
  }
}

const manana = {
  serviceId: 'manana',
  weekdays,
  weeksOfMonth: null,
  startTime: '08:00',
  endTime: '12:00',
  openEnded: false,
  validFrom: '2026-01-01',
  validTo: null,
}

describe('schedulesOverlap (P31.7)', () => {
  it('06–10 y 08–12 los mismos días se superponen', () => {
    expect(schedulesOverlap(manana, other())).toBe(true)
  })

  it('franjas que solo se tocan no se superponen', () => {
    expect(
      schedulesOverlap(manana, other({ startTime: '12:00', endTime: '14:00' })),
    ).toBe(false)
  })

  it('días distintos no se superponen', () => {
    expect(schedulesOverlap(manana, other({ weekdays: [6, 0] }))).toBe(false)
  })

  it('semanas del mes distintas no se superponen', () => {
    expect(
      schedulesOverlap(
        { ...manana, weeksOfMonth: [1, 3] },
        other({ weeksOfMonth: [2, 4] }),
      ),
    ).toBe(false)
  })

  it('vigencias que no se cruzan no se superponen', () => {
    expect(
      schedulesOverlap(
        manana,
        other({ validFrom: '2025-01-01', validTo: '2025-12-31' }),
      ),
    ).toBe(false)
  })

  it('«A terminar» se toma hasta el fin del día', () => {
    expect(
      schedulesOverlap(
        { ...manana, startTime: '20:00', endTime: null, openEnded: true },
        other({ startTime: '22:00', endTime: '23:00' }),
      ),
    ).toBe(true)
  })

  it('una franja que cruza medianoche choca con la de la noche', () => {
    expect(
      schedulesOverlap(
        { ...manana, startTime: '22:00', endTime: '02:00' },
        other({ startTime: '23:00', endTime: '23:30' }),
      ),
    ).toBe(true)
  })
})

describe('findFixedOverlaps (P31.7)', () => {
  it('avisa solo por las personas elegidas y no por el mismo servicio', () => {
    const result = findFixedOverlaps(
      manana,
      ['sofia'],
      [
        other(),
        other({ employeeId: 'otra' }),
        other({ serviceId: 'manana', serviceName: 'Limpieza mañana' }),
      ],
    )
    expect(result).toEqual([
      {
        employeeId: 'sofia',
        serviceName: 'Limpieza temprano',
        days: 'lun a vie',
        range: 'de 06:00 a 10:00',
      },
    ])
  })

  it('sin días o sin hora de inicio no compara', () => {
    expect(
      findFixedOverlaps({ ...manana, weekdays: [] }, ['sofia'], [other()]),
    ).toEqual([])
    expect(
      findFixedOverlaps({ ...manana, startTime: '' }, ['sofia'], [other()]),
    ).toEqual([])
  })
})
