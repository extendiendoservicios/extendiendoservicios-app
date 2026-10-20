import { describe, expect, it } from 'vitest'
import type { AttendanceBoardRow } from '@/api/attendance'
import type { EmployeeLeave } from '@/api/employees'
import {
  absenceLoadedBy,
  absenceReasonText,
  absenceRowsOf,
  buildLeavesAbsencesSheet,
  currentYearRange,
  daysText,
  LEAVES_ABSENCES_CONSENT_TEXT,
  leaveDaysInPeriod,
} from './leavesAbsencesSheet'

const PERSON = {
  name: 'Ana Gómez',
  dni: '30111222',
  employeeNumber: 7,
  roleLabels: ['Empleado'],
  signerLabel: 'Empleado',
}

function leave(overrides: Partial<EmployeeLeave> = {}): EmployeeLeave {
  return {
    id: 'l1',
    startsOn: '2026-03-02',
    endsOn: '2026-03-06',
    reason: 'Vacaciones',
    deletedAt: null,
    ...overrides,
  }
}

function absence(overrides: Partial<AttendanceBoardRow> = {}) {
  return {
    id: 'a1',
    shiftId: 'sh1',
    shiftDate: '2026-05-12',
    shiftStatus: 'completed',
    clientName: 'Limpia Ya SRL',
    siteName: 'Sede Centro',
    startTime: '08:00:00',
    endTime: '12:00:00',
    openEnded: false,
    status: 'absence_notified',
    removedAt: null,
    lastNoticeKind: 'absence',
    lastNoticeReasonCode: 'illness',
    lastNoticeReasonText: null,
    lastNoticeHasCertificate: true,
    lastNoticeSource: 'employee_app',
    lastNoticeReportedBy: 'e1',
    ...overrides,
  } as AttendanceBoardRow
}

describe('currentYearRange', () => {
  it('es el año en curso entero', () => {
    expect(currentYearRange('2026-10-20')).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    })
  })
})

describe('leaveDaysInPeriod', () => {
  it('cuenta los días con los extremos incluidos', () => {
    expect(
      leaveDaysInPeriod(leave(), '2026-01-01', '2026-12-31', '2026-10-20'),
    ).toBe(5)
  })

  it('recorta la licencia al período', () => {
    expect(
      leaveDaysInPeriod(
        leave({ startsOn: '2025-12-28', endsOn: '2026-01-03' }),
        '2026-01-01',
        '2026-12-31',
        '2026-10-20',
      ),
    ).toBe(3)
  })

  it('una licencia abierta cuenta hasta hoy', () => {
    expect(
      leaveDaysInPeriod(
        leave({ startsOn: '2026-10-15', endsOn: null }),
        '2026-01-01',
        '2026-12-31',
        '2026-10-20',
      ),
    ).toBe(6)
  })

  it('una licencia abierta que todavía no empezó no tiene días conocidos', () => {
    expect(
      leaveDaysInPeriod(
        leave({ startsOn: '2026-11-15', endsOn: null }),
        '2026-01-01',
        '2026-12-31',
        '2026-10-20',
      ),
    ).toBeNull()
  })

  it('fuera del período son 0', () => {
    expect(
      leaveDaysInPeriod(leave(), '2026-04-01', '2026-04-30', '2026-10-20'),
    ).toBe(0)
  })
})

describe('textos', () => {
  it('días en singular y plural', () => {
    expect(daysText(1)).toBe('1 día')
    expect(daysText(5)).toBe('5 días')
  })

  it('motivo de la ausencia: lista, texto libre, ambos o ninguno', () => {
    expect(
      absenceReasonText({
        lastNoticeReasonCode: 'illness',
        lastNoticeReasonText: null,
      }),
    ).toBe('Enfermedad')
    expect(
      absenceReasonText({
        lastNoticeReasonCode: 'other',
        lastNoticeReasonText: 'Mudanza',
      }),
    ).toBe('Mudanza')
    expect(
      absenceReasonText({
        lastNoticeReasonCode: 'illness',
        lastNoticeReasonText: 'Gripe',
      }),
    ).toBe('Enfermedad: Gripe')
    expect(
      absenceReasonText({
        lastNoticeReasonCode: null,
        lastNoticeReasonText: null,
      }),
    ).toBe('Sin motivo')
  })

  it('quién la cargó: el propio empleado o el nombre de administración', () => {
    expect(
      absenceLoadedBy(
        { lastNoticeSource: 'employee_app', lastNoticeReportedBy: 'e1' },
        new Map(),
      ),
    ).toBe('El propio empleado')
    expect(
      absenceLoadedBy(
        { lastNoticeSource: 'admin', lastNoticeReportedBy: 'u1' },
        new Map([['u1', { firstName: 'Marta', lastName: 'Ruiz' }]]),
      ),
    ).toBe('Marta Ruiz (administración)')
    expect(
      absenceLoadedBy(
        { lastNoticeSource: 'admin', lastNoticeReportedBy: 'u9' },
        new Map(),
      ),
    ).toBe('Administración')
  })
})

describe('absenceRowsOf', () => {
  it('solo las ausencias avisadas de turnos no cancelados y con asignación vigente', () => {
    const rows = absenceRowsOf([
      absence({ id: 'ok' }),
      absence({ id: 'cancelado', shiftStatus: 'cancelled' }),
      absence({ id: 'quitada', removedAt: '2026-05-10T10:00:00Z' }),
      absence({ id: 'demora', status: 'delay_notified' }),
      absence({ id: 'sin-aviso', status: 'expected', lastNoticeKind: null }),
    ])
    expect(rows.map((row) => row.id)).toEqual(['ok'])
  })
})

describe('buildLeavesAbsencesSheet', () => {
  const model = buildLeavesAbsencesSheet({
    person: PERSON,
    from: '2026-01-01',
    to: '2026-12-31',
    leaves: [
      leave(),
      leave({ id: 'l2', startsOn: '2026-10-15', endsOn: null, reason: null }),
      leave({ id: 'baja', deletedAt: '2026-03-01T00:00:00Z' }),
      leave({ id: 'otro-año', startsOn: '2025-02-01', endsOn: '2025-02-03' }),
    ],
    attendance: [
      absence({ id: 'a1', lastNoticeHasCertificate: true }),
      absence({
        id: 'a2',
        shiftDate: '2026-06-01',
        lastNoticeHasCertificate: false,
        lastNoticeSource: 'admin',
        lastNoticeReportedBy: 'u1',
        lastNoticeReasonCode: null,
      }),
      absence({
        id: 'a3',
        shiftDate: '2026-07-01',
        lastNoticeHasCertificate: null,
      }),
    ],
    names: new Map([['u1', { firstName: 'Marta', lastName: 'Ruiz' }]]),
    today: '2026-10-20',
  })

  it('lista las licencias del período, sin las dadas de baja ni las de otro año', () => {
    expect(model.leaveRows.map((row) => row.key)).toEqual(['l1', 'l2'])
    expect(model.leaveRows[0]).toMatchObject({
      reason: 'Vacaciones',
      to: '6 mar 2026',
      days: '5 días',
    })
    expect(model.leaveRows[1]).toMatchObject({
      to: 'Abierta',
      reason: '—',
      days: '6 días',
    })
    expect(model.leavesFooter.value).toBe('11 días')
  })

  it('lista las ausencias con certificado y quién las cargó', () => {
    expect(model.absenceRows.map((row) => row.certificate)).toEqual([
      'Con certificado',
      'Sin certificado',
      'Sin indicar',
    ])
    expect(model.absenceRows[0]).toMatchObject({
      client: 'Limpia Ya SRL',
      site: 'Sede Centro',
      schedule: '08:00–12:00',
      reason: 'Enfermedad',
      loadedBy: 'El propio empleado',
    })
    expect(model.absenceRows[1]).toMatchObject({
      reason: 'Sin motivo',
      loadedBy: 'Marta Ruiz (administración)',
    })
  })

  it('resume en los datos del encabezado', () => {
    const facts = Object.fromEntries(
      model.facts.map((fact) => [fact.label, fact.value]),
    )
    expect(facts['Licencias']).toBe('2 (11 días)')
    expect(facts['Ausencias a turnos']).toBe(
      '3 (1 con certificado, 1 sin certificado, 1 sin indicar)',
    )
    expect(facts['Período']).toBe('1 ene 2026 al 31 dic 2026')
    expect(model.documentTitle).toContain('Ana Gómez')
  })

  it('lleva los mismos datos personales, el consentimiento y las dos firmas que el detalle de asistencia', () => {
    expect(model.facts.slice(0, 4)).toEqual([
      { label: 'Nombre y Apellido', value: 'Ana Gómez' },
      { label: 'DNI', value: '30111222' },
      { label: 'Legajo', value: '7' },
      { label: 'Rol', value: 'Empleado' },
    ])
    expect(model.consentText).toBe(LEAVES_ABSENCES_CONSENT_TEXT)
    expect(model.signers).toEqual(['Responsable (administración)', 'Empleado'])
  })
})
