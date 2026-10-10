import { describe, expect, it } from 'vitest'
import { at, makeAssignment, NOW } from '@/features/dashboard/fixtures'
import { buildAttendanceEntries, buildAttendanceSheet } from './detailSheet'

/**
 * AJ2-15: la observación del turno (solo si tiene tildado «mostrar en la
 * impresión»: la base ya la manda en null si no) va en la columna
 * «Observaciones» de la hoja de asistencia, junto con la inasistencia.
 */
const person = {
  name: 'Carlos Medina',
  dni: '30111222',
  employeeNumber: 19,
  roleLabels: ['Empleado'],
  signerLabel: 'Empleado',
}

describe('buildAttendanceSheet con observación del turno (AJ2-15)', () => {
  it('la observación va sola en un turno trabajado y unida con « · » a una inasistencia', () => {
    const entries = buildAttendanceEntries(
      [
        makeAssignment({
          id: 'a1',
          shiftDate: '2026-09-28',
          checkInAt: at('08:01'),
          checkOutAt: at('12:00'),
          workedMinutes: 238,
          shiftObservation: 'Llevar llaves',
        }),
        makeAssignment({
          id: 'a0',
          shiftDate: '2026-09-29',
          endsAt: '2026-09-29T12:00:00-03:00',
          shiftObservation: 'Entrar por la cochera',
        }),
        makeAssignment({
          id: 'a2',
          shiftDate: '2026-09-30',
          checkInAt: at('08:01'),
          checkOutAt: at('12:00'),
          workedMinutes: 238,
          shiftObservation: null,
        }),
      ],
      [],
    )
    const sheet = buildAttendanceSheet({
      person,
      from: '2026-09-01',
      to: '2026-09-30',
      entries,
      now: NOW,
    })

    expect(sheet.rows.map((row) => [row.key, row.novelty])).toEqual([
      ['service-a1', 'Llevar llaves'],
      [
        'service-a0',
        'Inasistencia: sin fichaje de inicio · Entrar por la cochera',
      ],
      ['service-a2', ''],
    ])
  })
})
