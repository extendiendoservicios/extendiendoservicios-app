import { describe, expect, it } from 'vitest'
import type { SupervisionListRow } from '@/api/supervisions'
import { makeAssignment } from '@/features/dashboard/fixtures'
import { groupShiftPeople, peopleOfShift, summarizeNames } from './shiftPeople'

const supervision = (
  overrides: Partial<SupervisionListRow>,
): SupervisionListRow =>
  ({
    id: 'sup1',
    shiftId: 's1',
    supervisorFirstName: 'Sofía',
    supervisorLastName: 'Ruiz',
    status: 'in_progress',
    ...overrides,
  }) as SupervisionListRow

describe('groupShiftPeople (AJ2-18)', () => {
  it('agrupa por turno, ordena por apellido y suma el supervisor', () => {
    const people = groupShiftPeople(
      [
        makeAssignment({
          id: 'a1',
          shiftId: 's1',
          employeeFirstName: 'Valeria',
          employeeLastName: 'Paz',
        }),
        makeAssignment({
          id: 'a2',
          shiftId: 's1',
          employeeFirstName: 'Ana',
          employeeLastName: 'Gómez',
        }),
        makeAssignment({
          id: 'a3',
          shiftId: 's2',
          employeeFirstName: 'Carlos',
          employeeLastName: 'Medina',
        }),
      ],
      [supervision({})],
    )
    expect(people.get('s1')).toEqual({
      employees: ['Ana Gómez', 'Valeria Paz'],
      supervisors: ['Sofía Ruiz'],
    })
    expect(people.get('s2')).toEqual({
      employees: ['Carlos Medina'],
      supervisors: [],
    })
  })

  it('suma a los dos coordinadores que supervisan el mismo turno (CJ-05)', () => {
    const people = groupShiftPeople(
      [],
      [
        supervision({ id: 'a', shiftId: 's1', status: 'in_progress' }),
        supervision({
          id: 'b',
          shiftId: 's1',
          supervisorFirstName: 'Bruno',
          supervisorLastName: 'Gómez',
          status: 'completed',
        }),
      ],
    )
    expect(peopleOfShift(people, 's1').supervisors).toEqual([
      'Sofía Ruiz',
      'Bruno Gómez',
    ])
  })

  it('ignora asignaciones quitadas y supervisiones canceladas', () => {
    const people = groupShiftPeople(
      [makeAssignment({ id: 'a1', removedAt: '2026-09-30T07:00:00Z' })],
      [supervision({ status: 'cancelled' })],
    )
    expect(people.size).toBe(0)
  })

  it('un turno sin gente devuelve listas vacías', () => {
    expect(peopleOfShift(new Map(), 'sX')).toEqual({
      employees: [],
      supervisors: [],
    })
    expect(peopleOfShift(undefined, 'sX').employees).toEqual([])
  })
})

describe('summarizeNames', () => {
  it('muestra los primeros y «+N» con el resto', () => {
    const result = summarizeNames([
      'Ana Gómez',
      'Beto Ruiz',
      'Cleo Paz',
      'Dani Sosa',
    ])
    expect(result.text).toBe('Ana Gómez, Beto Ruiz +2')
    expect(result.extra).toBe(2)
    expect(result.full).toBe('Ana Gómez, Beto Ruiz, Cleo Paz, Dani Sosa')
  })

  it('sin excedente no agrega «+N»', () => {
    expect(summarizeNames(['Ana Gómez']).text).toBe('Ana Gómez')
    expect(summarizeNames([]).text).toBe('')
  })
})
