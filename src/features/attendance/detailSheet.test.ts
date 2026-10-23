import { describe, expect, it } from 'vitest'
import { at, makeAssignment, NOW } from '@/features/dashboard/fixtures'
import {
  ATTENDANCE_CONSENT_TEXT,
  buildAttendanceEntries,
  buildAttendanceSheet,
  personSignerLabel,
  printableEntries,
  sumWorkedMinutes,
} from './detailSheet'

const worked = (id: string, date: string, minutes: number | null) =>
  makeAssignment({
    id,
    shiftDate: date,
    checkInAt: at('08:01'),
    checkOutAt: minutes == null ? null : at('12:00'),
    workedMinutes: minutes,
  })

describe('buildAttendanceEntries / sumWorkedMinutes (AJ-06)', () => {
  it('ordena los servicios de la fecha más reciente a la más antigua', () => {
    const entries = buildAttendanceEntries([
      worked('a1', '2026-09-28', 238),
      worked('a2', '2026-09-30', 240),
    ])
    expect(entries.map((entry) => entry.key)).toEqual([
      'service-a2',
      'service-a1',
    ])
  })

  it('suma los minutos de los servicios; lo que no tiene fin no suma', () => {
    const entries = buildAttendanceEntries([
      worked('a1', '2026-09-28', 238),
      worked('a2', '2026-09-30', 240),
      worked('a3', '2026-09-27', null),
    ])
    expect(sumWorkedMinutes(entries)).toBe(238 + 240)
  })
})

function services(sheet: ReturnType<typeof buildAttendanceSheet>) {
  const section = sheet.sections.find((item) => item.key === 'services')
  if (!section) throw new Error('La hoja no tiene sección de turnos')
  return section
}

describe('buildAttendanceSheet (AJ-06)', () => {
  const person = {
    name: 'Carlos Medina',
    dni: '30111222',
    employeeNumber: 19,
    roleLabels: ['Empleado'],
    signerLabel: 'Empleado',
  }

  it('arma la hoja: datos de la persona, período, filas en orden cronológico, total y firmas', () => {
    const entries = buildAttendanceEntries([
      worked('a2', '2026-09-30', 240),
      worked('a1', '2026-09-28', 238),
      // Sin inicio y con la franja ya terminada: entra como inasistencia (AJ2-14).
      makeAssignment({
        id: 'a0',
        shiftDate: '2026-09-29',
        endsAt: '2026-09-29T12:00:00-03:00',
      }),
    ])
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
    expect(services(sheet).columns.map((column) => column.header)).toEqual([
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
      services(sheet).rows.map((row) => [
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
    expect(services(sheet).footer).toEqual({
      label: 'Total del período',
      value: '7 h 58 min',
    })
    expect(sheet.signers).toEqual(['Responsable (administración)', 'Empleado'])
    expect(sheet.consentText).toBe(ATTENDANCE_CONSENT_TEXT)
    expect(sheet.documentTitle).toContain('Carlos Medina')
  })

  it('un período sin horas deja la tabla vacía y el total en 0 min', () => {
    const sheet = buildAttendanceSheet({
      person,
      from: '2026-09-01',
      to: '2026-09-30',
      entries: [],
    })
    expect(services(sheet).rows).toEqual([])
    expect(services(sheet).footer.value).toBe('0 min')
  })
})

describe('printableEntries / personSignerLabel', () => {
  it('descarta lo que no tiene inicio registrado', () => {
    const entries = buildAttendanceEntries([
      worked('a1', '2026-09-28', 240),
      makeAssignment({ id: 'a0' }),
    ])
    // Sin inicio pero la franja no terminó (son las 11:00 y termina a las 12:00).
    expect(printableEntries(entries, NOW).map((entry) => entry.key)).toEqual([
      'service-a1',
    ])
  })

  it('incluye las inasistencias: franja terminada sin inicio, o con aviso de ausencia', () => {
    const entries = buildAttendanceEntries([
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
    ])
    expect(
      printableEntries(entries, NOW)
        .map((entry) => entry.key)
        .sort(),
    ).toEqual(['service-a1', 'service-a2', 'service-a3'])
  })

  it('el motivo del aviso de ausencia sale en la novedad', () => {
    const entries = buildAttendanceEntries([
      makeAssignment({
        id: 'a3',
        status: 'absence_notified',
        lastNoticeKind: 'absence',
        lastNoticeReasonCode: 'illness',
      }),
    ])
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
    expect(services(sheet).rows[0]?.novelty).toBe(
      'Inasistencia — certificado sin indicar — Enfermedad',
    )
    expect(services(sheet).footer.value).toBe('0 min')
  })

  it('intercala licencias e inasistencias con los turnos, ordenadas por fecha, y las licencias no suman horas', () => {
    const entries = buildAttendanceEntries([
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
    ])
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
    expect(services(sheet).rows.map((row) => row.key)).toEqual([
      'leave-l0',
      'service-a1',
      'service-a3',
      'leave-l1',
      'service-a2',
    ])
    expect(services(sheet).rows[0]).toMatchObject({
      date: '1 sep 2026',
      hours: '—',
      client: 'Licencia del 25/08/2026 al 03/09/2026 — Vacaciones',
      novelty: '',
    })
    // La observación ocupa de Cliente a Observaciones en una sola celda.
    expect(services(sheet).spans).toEqual({
      'leave-l0': { from: 'client', to: 'novelty' },
      'leave-l1': { from: 'client', to: 'novelty' },
    })
    expect(
      services(sheet)
        .columns.filter((c) => c.wrap)
        .map((c) => c.key),
    ).toEqual(['client', 'site', 'novelty'])
    expect(services(sheet).rows[2]?.novelty).toBe(
      'Inasistencia — con certificado — Enfermedad',
    )
    expect(services(sheet).rows[3]?.client).toBe(
      'Licencia del 18/09/2026 al abierta — Sin motivo',
    )
    // Solo suman las horas de los turnos trabajados: 4 h + 2 h.
    expect(sheet.totalMinutes).toBe(360)
    expect(services(sheet).footer.value).toBe('6 h')
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
    const entries = buildAttendanceEntries([
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
    ])
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
    expect(services(sheet).rows.map((row) => row.geo)).toEqual([
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
