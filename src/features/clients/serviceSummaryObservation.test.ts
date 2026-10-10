import { describe, expect, it } from 'vitest'
import type { ClientServiceSummary } from '@/api/clients'
import { makeAssignment } from '@/features/dashboard/fixtures'
import { buildClientSummarySheet } from './serviceSummary'

/**
 * AJ2-15: la observación del turno (`shifts[].observation`, que la base manda
 * solo si tiene tildado «mostrar en la impresión») va en «Observaciones» del
 * resumen del cliente, junto con «Sin salida» o la inasistencia.
 */
function makeSummary(observation: string | null): ClientServiceSummary {
  return {
    clientId: 'c1',
    from: '2026-10-01',
    to: '2026-10-07',
    totals: {
      shiftsDone: 1,
      employeesCount: 2,
      workedMinutes: 478,
      plannedMinutes: 480,
      openEndedShifts: 1,
    },
    shifts: [
      {
        shiftId: 's1',
        shiftDate: '2026-10-05',
        siteId: 'site1',
        siteName: 'Munro',
        startTime: '08:00:00',
        endTime: '23:59:00',
        status: 'completed',
        workedMinutes: 478,
        plannedMinutes: 480,
        openEnded: true,
        observation,
        employees: [
          {
            assignmentId: 'a1',
            employeeId: 'e1',
            firstName: 'Carlos',
            lastName: 'Medina',
            status: 'finished',
            checkInAt: '2026-10-05T11:01:00Z',
            checkOutAt: '2026-10-05T15:00:00Z',
            plannedMinutes: null,
            workedMinutes: 238,
            openEnded: true,
            noCheckout: false,
          },
          {
            assignmentId: 'a2',
            employeeId: 'e2',
            firstName: 'Valeria',
            lastName: 'Paz',
            status: 'finished',
            checkInAt: '2026-10-05T11:05:00Z',
            checkOutAt: null,
            plannedMinutes: null,
            workedMinutes: 0,
            openEnded: true,
            noCheckout: true,
          },
        ],
      },
    ],
  }
}

describe('buildClientSummarySheet con observación del turno (AJ2-15)', () => {
  it('la observación va en cada fila del turno, unida con « · » a «Sin salida»', () => {
    const sheet = buildClientSummarySheet({
      clientName: 'Logística Central',
      cuit: null,
      summary: makeSummary('Llevar llaves'),
    })
    expect(sheet.rows.map((row) => row.novelty)).toEqual([
      'Llevar llaves',
      'Sin salida · Llevar llaves',
    ])
  })

  it('sin observación (o sin casilla tildada) la columna queda como antes', () => {
    const sheet = buildClientSummarySheet({
      clientName: 'Logística Central',
      cuit: null,
      summary: makeSummary(null),
    })
    expect(sheet.rows.map((row) => row.novelty)).toEqual(['', 'Sin salida'])
  })

  it('en una inasistencia agrega la observación del turno', () => {
    const sheet = buildClientSummarySheet({
      clientName: 'Logística Central',
      cuit: null,
      summary: { ...makeSummary(null), shifts: [] },
      absences: [
        makeAssignment({
          id: 'x1',
          shiftDate: '2026-10-06',
          endsAt: '2026-10-06T12:00:00-03:00',
          shiftObservation: 'Entrar por la cochera',
        }),
      ],
      now: new Date('2026-10-07T12:00:00-03:00'),
    })
    expect(sheet.rows[0]?.novelty).toBe(
      'Inasistencia: sin fichaje de inicio · Entrar por la cochera',
    )
  })
})
