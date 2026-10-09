import { describe, expect, it } from 'vitest'
import type { ClientServiceSummary } from '@/api/clients'
import { makeAssignment } from '@/features/dashboard/fixtures'
import {
  buildClientSummarySheet,
  currentMonthRange,
  formatWorkedHours,
  monthName,
  shiftEmployeeNames,
  summarySheetEmployeeIds,
} from './serviceSummary'

const summary: ClientServiceSummary = {
  clientId: 'c1',
  from: '2026-10-01',
  to: '2026-10-07',
  totals: {
    shiftsDone: 2,
    employeesCount: 2,
    workedMinutes: 718,
    plannedMinutes: 720,
  },
  shifts: [
    {
      shiftId: 's1',
      shiftDate: '2026-10-05',
      siteId: 'site1',
      siteName: 'Munro',
      startTime: '08:00:00',
      endTime: '12:00:00',
      status: 'completed',
      workedMinutes: 478,
      plannedMinutes: 480,
      employees: [
        {
          assignmentId: 'a1',
          employeeId: 'e1',
          firstName: 'Carlos',
          lastName: 'Medina',
          status: 'finished',
          checkInAt: '2026-10-05T11:01:00Z',
          checkOutAt: '2026-10-05T15:00:00Z',
          plannedMinutes: 240,
          workedMinutes: 239,
        },
        {
          assignmentId: 'a2',
          employeeId: 'e2',
          firstName: 'Valeria',
          lastName: 'Paz',
          status: 'finished',
          checkInAt: '2026-10-05T11:00:00Z',
          checkOutAt: '2026-10-05T15:00:00Z',
          plannedMinutes: 240,
          workedMinutes: 239,
        },
        {
          assignmentId: 'a3',
          employeeId: 'e3',
          firstName: 'Ana',
          lastName: 'Gómez',
          status: 'absence_notified',
          checkInAt: null,
          checkOutAt: null,
          plannedMinutes: 240,
          workedMinutes: null,
        },
      ],
    },
    {
      shiftId: 's2',
      shiftDate: '2026-10-06',
      siteId: 'site1',
      siteName: 'Munro',
      startTime: '14:00:00',
      endTime: '18:00:00',
      status: 'in_progress',
      workedMinutes: 240,
      plannedMinutes: 240,
      employees: [],
    },
  ],
}

describe('período y formato del mes (AJ-10)', () => {
  it('el mes en curso va del 1 a hoy', () => {
    expect(currentMonthRange('2026-10-07')).toEqual({
      from: '2026-10-01',
      to: '2026-10-07',
    })
    expect(currentMonthRange('2026-12-31')).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    })
  })

  it('nombra el mes en español y en minúscula', () => {
    expect(monthName('2026-10-01')).toBe('octubre')
    expect(monthName('2027-01-15')).toBe('enero')
  })

  it('muestra «0 h» sin trabajo y duración legible con trabajo', () => {
    expect(formatWorkedHours(undefined)).toBe('0 h')
    expect(formatWorkedHours(0)).toBe('0 h')
    expect(formatWorkedHours(750)).toBe('12 h 30 min')
  })
})

describe('buildClientSummarySheet (AJ-09)', () => {
  it('lista solo a quienes trabajaron, por turno, y arma datos, filas y total', () => {
    expect(shiftEmployeeNames(summary.shifts[0]!)).toEqual([
      'Medina, Carlos',
      'Paz, Valeria',
    ])

    const sheet = buildClientSummarySheet({
      clientName: 'Logística Central',
      cuit: '30-12345678-9',
      summary,
    })
    expect(sheet.title).toBe('Resumen de servicios')
    expect(sheet.facts).toEqual([
      { label: 'Cliente', value: 'Logística Central' },
      { label: 'CUIT', value: '30-12345678-9' },
      { label: 'Período', value: '1 oct 2026 al 7 oct 2026' },
      { label: 'Turnos realizados', value: '2' },
      { label: 'Empleados distintos', value: '2' },
    ])
    expect(sheet.columns.map((column) => column.header)).toEqual([
      'Fecha',
      'Sede',
      'Franja',
      'Nombre y Apellido',
      'DNI',
      'Novedad',
      'Horas',
    ])
    // Una fila por persona y turno; DNI «—» si no se pasó.
    expect(sheet.rows).toEqual([
      {
        key: 'a1',
        date: '5 oct 2026',
        site: 'Munro',
        franja: '08:00–12:00',
        name: 'Carlos Medina',
        dni: '—',
        novelty: '',
        hours: '3 h 59 min',
      },
      {
        key: 'a2',
        date: '5 oct 2026',
        site: 'Munro',
        franja: '08:00–12:00',
        name: 'Valeria Paz',
        dni: '—',
        novelty: '',
        hours: '3 h 59 min',
      },
    ])
    expect(sheet.footer).toEqual({
      label: 'Horas totales',
      value: '11 h 58 min',
    })
    // Una sola firma: la del responsable de administración.
    expect(sheet.signers).toEqual(['Responsable (administración)'])
  })

  it('con DNI, sin turnos sin inicio y con CUIT sin guiones lo formatea', () => {
    const sheet = buildClientSummarySheet({
      clientName: 'Cliente',
      cuit: '30123456789',
      summary,
      dnis: new Map([
        ['e1', '30111222'],
        ['e2', '28999888'],
      ]),
    })
    expect(sheet.facts).toContainEqual({
      label: 'CUIT',
      value: '30-12345678-9',
    })
    expect(sheet.rows.map((row) => row.dni)).toEqual(['30111222', '28999888'])
  })

  it('incluye las inasistencias (AJ2-14): del mismo turno y de turnos donde nadie fichó', () => {
    const now = new Date('2026-10-07T12:00:00-03:00')
    const sheet = buildClientSummarySheet({
      clientName: 'Cliente',
      cuit: null,
      summary,
      now,
      dnis: new Map([['e3', '27555666']]),
      absences: [
        // Del turno s1: aviso de ausencia con motivo.
        makeAssignment({
          id: 'a3',
          shiftId: 's1',
          shiftDate: '2026-10-05',
          employeeId: 'e3',
          employeeFirstName: 'Ana',
          employeeLastName: 'Gómez',
          siteName: 'Munro',
          status: 'absence_notified',
          lastNoticeKind: 'absence',
          lastNoticeReasonCode: 'illness',
        }),
        // Turno donde nadie fichó (no está en el resumen), franja terminada.
        makeAssignment({
          id: 'a9',
          shiftId: 's9',
          shiftDate: '2026-10-03',
          employeeId: 'e9',
          employeeFirstName: 'Luis',
          employeeLastName: 'Pérez',
          siteName: 'Munro',
          startTime: '08:00:00',
          endTime: '12:00:00',
          endsAt: '2026-10-03T12:00:00-03:00',
        }),
        // Turno de hoy que todavía no terminó: no es inasistencia.
        makeAssignment({
          id: 'a10',
          shiftDate: '2026-10-07',
          employeeId: 'e10',
          endsAt: '2026-10-07T18:00:00-03:00',
        }),
      ],
    })
    expect(
      sheet.rows.map((row) => [row.key, row.name, row.novelty, row.hours]),
    ).toEqual([
      ['a9', 'Luis Pérez', 'Inasistencia: sin fichaje de inicio', '—'],
      ['a3', 'Ana Gómez', 'Ausencia avisada: Enfermedad', '—'],
      ['a1', 'Carlos Medina', '', '3 h 59 min'],
      ['a2', 'Valeria Paz', '', '3 h 59 min'],
    ])
    expect(sheet.rows.find((row) => row.key === 'a3')?.dni).toBe('27555666')
    expect(sheet.facts).toContainEqual({ label: 'Inasistencias', value: '2' })
  })

  it('summarySheetEmployeeIds junta quienes trabajaron y quienes faltaron, sin repetir', () => {
    const ids = summarySheetEmployeeIds(summary, [
      makeAssignment({ employeeId: 'e3' }),
      makeAssignment({ id: 'x', employeeId: 'e1' }),
    ])
    expect(ids.sort()).toEqual(['e1', 'e2', 'e3'])
  })

  it('sin CUIT omite el dato', () => {
    const sheet = buildClientSummarySheet({
      clientName: 'Cliente',
      cuit: null,
      summary,
    })
    expect(sheet.facts.map((fact) => fact.label)).not.toContain('CUIT')
  })
})
