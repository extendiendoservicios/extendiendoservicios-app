import { describe, expect, it } from 'vitest'
import { makeAssignment } from '@/features/dashboard/fixtures'
import {
  groupUnsupervisedShifts,
  resolveUnsupervisedRange,
  unsupervisedStatusBadge,
} from './unsupervised'

const started = {
  checkInAt: '2026-11-20T08:02:00-03:00',
  displayStatus: 'present',
  status: 'present' as const,
  supervisionState: 'none' as const,
}

describe('groupUnsupervisedShifts (P35.2, D-06, D-07)', () => {
  it('agrupa por turno: una fila con todos los empleados', () => {
    const result = groupUnsupervisedShifts([
      makeAssignment({
        id: 'a1',
        shiftId: 's1',
        employeeId: 'e1',
        employeeFirstName: 'Ana',
        employeeLastName: 'Gómez',
        ...started,
      }),
      makeAssignment({
        id: 'a2',
        shiftId: 's1',
        employeeId: 'e2',
        employeeFirstName: 'Beto',
        employeeLastName: 'Ruiz',
        ...started,
      }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]!.employees.map((e) => e.name)).toEqual([
      'Ana Gómez',
      'Beto Ruiz',
    ])
  })

  it('no incluye turnos que ya tienen supervisión ni los que no empezaron', () => {
    const result = groupUnsupervisedShifts([
      makeAssignment({
        id: 'a1',
        shiftId: 's1',
        ...started,
        supervisionState: 'done',
      }),
      makeAssignment({ id: 'a2', shiftId: 's2', supervisionState: 'none' }),
      makeAssignment({
        id: 'a3',
        shiftId: 's3',
        ...started,
        shiftStatus: 'cancelled',
      }),
      makeAssignment({
        id: 'a4',
        shiftId: 's4',
        supervisionState: 'none',
        status: 'absence_notified',
        displayStatus: 'absence_notified',
        checkInAt: null,
      }),
    ])
    expect(result).toEqual([])
  })

  it('«Sin registro» cuenta como servicio empezado', () => {
    const result = groupUnsupervisedShifts([
      makeAssignment({
        id: 'a1',
        shiftId: 's1',
        supervisionState: 'none',
        displayStatus: 'no_record',
      }),
    ])
    expect(result).toHaveLength(1)
  })

  it('el estado del turno es el de la persona más relevante', () => {
    const [shift] = groupUnsupervisedShifts([
      makeAssignment({ id: 'a1', shiftId: 's1', employeeId: 'e1', ...started }),
      makeAssignment({
        id: 'a2',
        shiftId: 's1',
        employeeId: 'e2',
        supervisionState: 'none',
        displayStatus: 'no_record',
      }),
    ])
    expect(unsupervisedStatusBadge(shift!)).toMatchObject({
      status: 'no_record',
    })
  })

  it('ordena del más reciente al más viejo (fecha y hora)', () => {
    const result = groupUnsupervisedShifts([
      makeAssignment({
        id: 'a1',
        shiftId: 's1',
        shiftDate: '2026-11-18',
        startTime: '08:00:00',
        ...started,
      }),
      makeAssignment({
        id: 'a2',
        shiftId: 's2',
        shiftDate: '2026-11-20',
        startTime: '08:00:00',
        ...started,
      }),
      makeAssignment({
        id: 'a3',
        shiftId: 's3',
        shiftDate: '2026-11-20',
        startTime: '14:00:00',
        ...started,
      }),
    ])
    expect(result.map((s) => s.shiftId)).toEqual(['s3', 's2', 's1'])
  })
})

describe('resolveUnsupervisedRange (D-08, D-10)', () => {
  it('sin fechas: los últimos 7 días hasta hoy', () => {
    expect(resolveUnsupervisedRange('', '', '2026-11-26')).toEqual({
      from: '2026-11-20',
      to: '2026-11-26',
      isDefault: true,
      tooLong: false,
    })
  })

  it('con fechas elegidas respeta el período', () => {
    const range = resolveUnsupervisedRange(
      '2026-10-01',
      '2026-10-31',
      '2026-11-26',
    )
    expect(range).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
      isDefault: false,
      tooLong: false,
    })
  })

  it('más de 62 días no se consulta; 62 sí', () => {
    expect(
      resolveUnsupervisedRange('2026-09-01', '2026-11-01', '2026-11-26')
        .tooLong,
    ).toBe(false)
    expect(
      resolveUnsupervisedRange('2026-09-01', '2026-11-02', '2026-11-26')
        .tooLong,
    ).toBe(true)
  })

  it('solo «desde» llega hasta hoy', () => {
    expect(resolveUnsupervisedRange('2026-11-01', '', '2026-11-26').to).toBe(
      '2026-11-26',
    )
  })
})
