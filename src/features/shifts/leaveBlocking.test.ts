import { describe, expect, it } from 'vitest'
import { employeesOnLeaveIn } from './leaveBlocking'

const LEAVES = [
  { employeeId: 'e1', startsOn: '2026-10-10', endsOn: '2026-10-15' },
  { employeeId: 'e2', startsOn: '2026-10-20', endsOn: null },
  { employeeId: 'e3', startsOn: '2026-11-01', endsOn: '2026-11-05' },
]

describe('employeesOnLeaveIn', () => {
  it('marca a quien tiene licencia ese día, extremos incluidos', () => {
    expect([...employeesOnLeaveIn(LEAVES, '2026-10-15', '2026-10-15')]).toEqual(
      ['e1'],
    )
    expect([...employeesOnLeaveIn(LEAVES, '2026-10-10', '2026-10-10')]).toEqual(
      ['e1'],
    )
  })

  it('una licencia abierta alcanza a cualquier fecha posterior', () => {
    expect([...employeesOnLeaveIn(LEAVES, '2027-01-01', '2027-01-01')]).toEqual(
      ['e2'],
    )
  })

  it('en un rango marca a quien tiene licencia en alguna fecha', () => {
    expect(
      [...employeesOnLeaveIn(LEAVES, '2026-10-14', '2026-10-21')].sort(),
    ).toEqual(['e1', 'e2'])
  })

  it('no marca a nadie fuera de las licencias', () => {
    expect(employeesOnLeaveIn(LEAVES, '2026-10-16', '2026-10-19').size).toBe(0)
  })
})
