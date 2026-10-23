import { describe, expect, it } from 'vitest'
import { employeesToRate, pendingRatings } from './ratings'

const employee = (id: string, checkInAt: string | null) => ({
  employeeId: id,
  firstName: `Nombre ${id}`,
  lastName: 'Apellido',
  status: 'present' as const,
  checkInAt,
})

describe('pendingRatings (CJ-10, CJ-28)', () => {
  const supervision = {
    assignedEmployees: [
      employee('e1', '2026-10-23T11:00:00Z'),
      employee('e2', '2026-10-23T11:05:00Z'),
      employee('e3', null), // ausente: no se califica
      employee('me', '2026-10-23T11:00:00Z'), // el propio coordinador
    ],
  }
  const assignments = [
    { assignmentId: 'a1', employeeId: 'e1' },
    { assignmentId: 'a2', employeeId: 'e2' },
    { assignmentId: 'a3', employeeId: 'e3' },
    { assignmentId: 'am', employeeId: 'me' },
  ]

  it('solo cuentan los empleados con inicio registrado y sin el propio coordinador', () => {
    expect(employeesToRate(supervision, 'me').map((e) => e.employeeId)).toEqual(
      ['e1', 'e2'],
    )
  })

  it('lista a quienes todavía no calificó', () => {
    const pending = pendingRatings(
      supervision,
      assignments,
      [{ id: 'r1', assignmentId: 'a1', score: 4, comment: null }],
      'me',
    )
    expect(pending).toEqual([
      {
        employeeId: 'e2',
        assignmentId: 'a2',
        name: 'Nombre e2 Apellido',
      },
    ])
  })

  it('no queda nadie pendiente cuando calificó a todos', () => {
    const ratings = [
      { id: 'r1', assignmentId: 'a1', score: 4, comment: null },
      { id: 'r2', assignmentId: 'a2', score: 5, comment: 'Muy bien' },
    ]
    expect(pendingRatings(supervision, assignments, ratings, 'me')).toEqual([])
  })
})
