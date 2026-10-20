import { describe, expect, it } from 'vitest'
import type { SupervisionListRow } from '@/api/supervisions'
import { at, makeAssignment, NOW } from '@/features/dashboard/fixtures'
import {
  ATTENDANCE_CONSENT_TEXT,
  buildAttendanceEntries,
  buildAttendanceSheet,
  personSignerLabel,
  printableEntries,
  sumWorkedMinutes,
} from './detailSheet'

function makeSupervision(
  overrides: Partial<SupervisionListRow> = {},
): SupervisionListRow {
  return {
    id: 'sup1',
    shiftId: 's9',
    shiftDate: '2026-09-29',
    clientId: 'c1',
    clientName: 'Cliente Uno',
    siteId: 'site1',
    siteName: 'Sede Uno',
    startTime: '09:00:00',
    endTime: '10:00:00',
    shiftOpenEnded: false,
    supervisorId: 'e9',
    supervisorFirstName: 'Sofía',
    supervisorLastName: 'Ruiz',
    status: 'completed',
    assignedAt: '2026-09-28T12:00:00Z',
    checkInAt: '2026-09-29T12:00:00Z',
    checkOutAt: '2026-09-29T13:00:00Z',
    generalNotes: null,
    cancelReason: null,
    notDoneReason: null,
    criteriaSnapshot: [],
    ratingsCount: 0,
    ratingsAvg: null,
    assignedEmployeesCount: 2,
    plannedMinutes: 60,
    workedMinutes: 60,
    ...overrides,
  }
}

const worked = (id: string, date: string, minutes: number | null) =>
  makeAssignment({
    id,
    shiftDate: date,
    checkInAt: at('08:01'),
    checkOutAt: minutes == null ? null : at('12:00'),
    workedMinutes: minutes,
  })

describe('buildAttendanceEntries / sumWorkedMinutes (AJ-06)', () => {
  it('une servicios y supervisiones de la fecha más reciente a la más antigua', () => {
    const entries = buildAttendanceEntries(
      [worked('a1', '2026-09-28', 238), worked('a2', '2026-09-30', 240)],
      [makeSupervision({ shiftDate: '2026-09-29' })],
    )
    expect(entries.map((entry) => entry.key)).toEqual([
      'service-a2',
      'supervision-sup1',
      'service-a1',
    ])
  })

  it('suma los minutos de servicios y supervisiones; lo que no tiene fin no suma', () => {
    const entries = buildAttendanceEntries(
      [
        worked('a1', '2026-09-28', 238),
        worked('a2', '2026-09-30', 240),
        worked('a3', '2026-09-27', null),
      ],
      [makeSupervision({ workedMinutes: 55 })],
    )
    expect(sumWorkedMinutes(entries)).toBe(238 + 240 + 55)
  })
})

describe('buildAttendanceSheet (AJ-06)', () => {
  const person = {
    name: 'Carlos Medina',
    dni: '30111222',
    employeeNumber: 19,
    roleLabels: ['Empleado'],
    signerLabel: 'Empleado',
  }

  it('arma la hoja: datos de la persona, período, filas en orden cronológico, total y firmas', () => {
    const entries = buildAttendanceEntries(
      [
        worked('a2', '2026-09-30', 240),
        worked('a1', '2026-09-28', 238),
        // Sin inicio y con la franja ya terminada: entra como inasistencia (AJ2-14).
        makeAssignment({
          id: 'a0',
          shiftDate: '2026-09-29',
          endsAt: '2026-09-29T12:00:00-03:00',
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

    expect(sheet.title).toBe('Detalle de asistencia')
    expect(sheet.facts).toEqual([
      { label: 'Nombre y Apellido', value: 'Carlos Medina' },
      { label: 'DNI', value: '30111222' },
      { label: 'Legajo', value: '19' },
      { label: 'Rol', value: 'Empleado' },
      { label: 'Período', value: '1 sep 2026 al 30 sep 2026' },
      { label: 'Inasistencias', value: '1' },
    ])
    expect(sheet.columns.map((column) => column.header)).toEqual([
      'Fecha',
      'Cliente',
      'Sede',
      'Franja',
      'Inicio',
      'Fin',
      'Validación',
      'Observaciones',
      'Horas',
    ])
    expect(
      sheet.rows.map((row) => [
        row.key,
        row.hours,
        row.start,
        row.end,
        row.novelty,
      ]),
    ).toEqual([
      ['service-a1', '3 h 58 min', '08:01', '12:00', ''],
      ['service-a0', '—', '—', '—', 'Inasistencia: sin fichaje de inicio'],
      ['service-a2', '4 h', '08:01', '12:00', ''],
    ])
    expect(sheet.totalMinutes).toBe(478)
    expect(sheet.footer).toEqual({
      label: 'Total del período',
      value: '7 h 58 min',
    })
    expect(sheet.signers).toEqual(['Responsable (administración)', 'Empleado'])
    expect(sheet.consentText).toBe(ATTENDANCE_CONSENT_TEXT)
    expect(sheet.documentTitle).toContain('Carlos Medina')
  })

  it('con supervisiones agrega la columna «Tipo» y las identifica', () => {
    const entries = buildAttendanceEntries(
      [worked('a1', '2026-09-28', 240)],
      [makeSupervision()],
    )
    const sheet = buildAttendanceSheet({
      person: {
        ...person,
        roleLabels: ['Empleado', 'Coordinador'],
        signerLabel: 'Empleado y coordinador',
      },
      from: '2026-09-01',
      to: '2026-09-30',
      entries,
    })
    expect(sheet.columns[1]).toEqual({ key: 'kind', header: 'Tipo' })
    expect(sheet.rows.map((row) => row.kind)).toEqual([
      'Servicio',
      'Supervisión',
    ])
    expect(sheet.totalMinutes).toBe(300)
  })

  it('un período sin horas deja la tabla vacía y el total en 0 min', () => {
    const sheet = buildAttendanceSheet({
      person,
      from: '2026-09-01',
      to: '2026-09-30',
      entries: [],
    })
    expect(sheet.rows).toEqual([])
    expect(sheet.footer.value).toBe('0 min')
  })
})

describe('printableEntries / personSignerLabel', () => {
  it('descarta lo que no tiene inicio registrado', () => {
    const entries = buildAttendanceEntries(
      [worked('a1', '2026-09-28', 240), makeAssignment({ id: 'a0' })],
      [],
    )
    // Sin inicio pero la franja no terminó (son las 11:00 y termina a las 12:00).
    expect(printableEntries(entries, NOW).map((entry) => entry.key)).toEqual([
      'service-a1',
    ])
  })

  it('incluye las inasistencias: franja terminada sin inicio, o con aviso de ausencia', () => {
    const entries = buildAttendanceEntries(
      [
        worked('a1', '2026-09-28', 240),
        // Franja terminada sin fichaje.
        makeAssignment({ id: 'a2', endsAt: at('10:00') }),
        // Con aviso de ausencia aunque la franja siga en curso.
        makeAssignment({
          id: 'a3',
          status: 'absence_notified',
          lastNoticeKind: 'absence',
          lastNoticeReasonCode: 'illness',
        }),
        // Turno cancelado: no es inasistencia.
        makeAssignment({
          id: 'a4',
          endsAt: at('10:00'),
          shiftStatus: 'cancelled',
        }),
        // Asignación quitada: no es inasistencia.
        makeAssignment({
          id: 'a5',
          endsAt: at('10:00'),
          removedAt: at('07:00'),
        }),
      ],
      [],
    )
    expect(
      printableEntries(entries, NOW)
        .map((entry) => entry.key)
        .sort(),
    ).toEqual(['service-a1', 'service-a2', 'service-a3'])
  })

  it('el motivo del aviso de ausencia sale en la novedad', () => {
    const entries = buildAttendanceEntries(
      [
        makeAssignment({
          id: 'a3',
          status: 'absence_notified',
          lastNoticeKind: 'absence',
          lastNoticeReasonCode: 'illness',
        }),
      ],
      [],
    )
    const sheet = buildAttendanceSheet({
      person: {
        name: 'X',
        employeeNumber: 1,
        roleLabels: [],
        signerLabel: 'P',
      },
      from: '2026-09-01',
      to: '2026-09-30',
      entries,
      now: NOW,
    })
    expect(sheet.rows[0]?.novelty).toBe(
      'Inasistencia — certificado sin indicar — Enfermedad',
    )
    expect(sheet.footer.value).toBe('0 min')
  })

  it('intercala licencias e inasistencias con los turnos, ordenadas por fecha, y las licencias no suman horas', () => {
    const entries = buildAttendanceEntries(
      [
        worked('a1', '2026-09-10', 240),
        worked('a2', '2026-09-20', 120),
        makeAssignment({
          id: 'a3',
          shiftDate: '2026-09-15',
          status: 'absence_notified',
          lastNoticeKind: 'absence',
          lastNoticeReasonCode: 'illness',
          lastNoticeHasCertificate: true,
        }),
      ],
      [],
    )
    const leaves = [
      // Empezó antes del período: va al inicio.
      {
        id: 'l0',
        startsOn: '2026-08-25',
        endsOn: '2026-09-03',
        reason: 'Vacaciones',
        deletedAt: null,
      },
      {
        id: 'l1',
        startsOn: '2026-09-18',
        endsOn: null,
        reason: null,
        deletedAt: null,
      },
      // Dada de baja y de otro período: no entran.
      {
        id: 'l2',
        startsOn: '2026-09-05',
        endsOn: '2026-09-06',
        reason: 'x',
        deletedAt: '2026-09-01T00:00:00Z',
      },
      {
        id: 'l3',
        startsOn: '2026-01-05',
        endsOn: '2026-01-06',
        reason: 'y',
        deletedAt: null,
      },
    ]
    const sheet = buildAttendanceSheet({
      person: {
        name: 'Carlos Medina',
        employeeNumber: 19,
        roleLabels: ['Empleado'],
        signerLabel: 'Empleado',
      },
      from: '2026-09-01',
      to: '2026-09-30',
      entries,
      leaves,
      now: NOW,
    })
    expect(sheet.rows.map((row) => row.key)).toEqual([
      'leave-l0',
      'service-a1',
      'service-a3',
      'leave-l1',
      'service-a2',
    ])
    expect(sheet.rows[0]).toMatchObject({
      date: '1 sep 2026',
      hours: '—',
      client: 'Licencia del 25/08/2026 al 03/09/2026 — Vacaciones',
      novelty: '',
    })
    // La observación ocupa de Cliente a Observaciones en una sola celda.
    expect(sheet.spans).toEqual({
      'leave-l0': { from: 'client', to: 'novelty' },
      'leave-l1': { from: 'client', to: 'novelty' },
    })
    expect(sheet.columns.filter((c) => c.wrap).map((c) => c.key)).toEqual([
      'client',
      'site',
      'novelty',
    ])
    expect(sheet.rows[2]?.novelty).toBe(
      'Inasistencia — con certificado — Enfermedad',
    )
    expect(sheet.rows[3]?.client).toBe(
      'Licencia del 18/09/2026 al abierta — Sin motivo',
    )
    // Solo suman las horas de los turnos trabajados: 4 h + 2 h.
    expect(sheet.totalMinutes).toBe(360)
    expect(sheet.footer.value).toBe('6 h')
    expect(sheet.facts).toContainEqual({ label: 'Inasistencias', value: '1' })
    expect(sheet.facts).toContainEqual({ label: 'Licencias', value: '2' })
  })

  it('la hoja imprimible lleva la validación por ubicación sin coordenadas (B-20)', () => {
    const geo = (overrides: Record<string, unknown>) => ({
      recordId: 'r',
      status: 'valid' as const,
      reason: null,
      distanceM: 10,
      radiusM: 150,
      accuracyM: 12,
      outsideReason: null,
      overridden: false,
      timeCorrected: false,
      ...overrides,
    })
    const entries = buildAttendanceEntries(
      [
        makeAssignment({
          id: 'a1',
          shiftDate: '2026-09-28',
          checkInAt: at('08:01'),
          checkOutAt: at('12:00'),
          workedMinutes: 239,
          checkInGeo: geo({}),
          checkOutGeo: geo({ status: 'outside', distanceM: 350 }),
        }),
        makeAssignment({
          id: 'a2',
          shiftDate: '2026-09-29',
          checkInAt: at('08:00'),
          workedMinutes: null,
          checkInGeo: geo({ status: 'unvalidated', reason: 'no_location' }),
        }),
      ],
      [],
    )
    const sheet = buildAttendanceSheet({
      person: {
        name: 'Carlos Medina',
        employeeNumber: 19,
        roleLabels: ['Empleado'],
        signerLabel: 'Empleado',
      },
      from: '2026-09-01',
      to: '2026-09-30',
      entries,
      now: NOW,
    })
    expect(sheet.rows.map((row) => row.geo)).toEqual([
      'Inicio: Validado · Fin: Fuera de zona (350 m)',
      'Sin validar',
    ])
  })

  it('arma la etiqueta de la firma de la persona según sus roles', () => {
    expect(personSignerLabel(['Empleado'])).toBe('Empleado')
    expect(personSignerLabel(['Coordinador'])).toBe('Coordinador')
    expect(personSignerLabel(['Empleado', 'Coordinador'])).toBe(
      'Empleado y coordinador',
    )
    expect(personSignerLabel([])).toBe('Persona')
  })
})
