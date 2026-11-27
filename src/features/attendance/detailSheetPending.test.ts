import { describe, expect, it } from 'vitest'
import { makeAssignment, NOW } from '@/features/dashboard/fixtures'
import { makeWorkday } from '@/features/geo/coordinatorFixtures'
import {
  buildAttendanceEntries,
  buildAttendanceSheet,
  BLANK_WORKDAYS_SHEET_NOTE,
  PENDING_SHEET_NOTE,
  printableEntries,
} from './detailSheet'

// NOW = 30 sep 2026, 11:00 (Buenos Aires).
const person = {
  name: 'Carlos Medina',
  dni: '30111222',
  employeeNumber: 19,
  roleLabels: ['Empleado'],
  signerLabel: 'Empleado',
}

const pendingShift = (id: string, date: string, extra = {}) =>
  makeAssignment({
    id,
    shiftDate: date,
    startTime: '08:00:00',
    endTime: '12:00:00',
    endsAt: `${date}T12:00:00-03:00`,
    ...extra,
  })

function build(
  rows: ReturnType<typeof makeAssignment>[],
  extra: Partial<Parameters<typeof buildAttendanceSheet>[0]> = {},
) {
  return buildAttendanceSheet({
    person,
    from: '2026-09-01',
    to: '2026-09-30',
    entries: buildAttendanceEntries(rows),
    now: NOW,
    ...extra,
  })
}

function services(sheet: ReturnType<typeof buildAttendanceSheet>) {
  const section = sheet.sections.find((item) => item.key === 'services')
  if (!section) throw new Error('Sin sección de turnos')
  return section
}

describe('P36: turnos asignados sin trabajar en la hoja', () => {
  it('la fila pendiente deja inicio, fin y validación en blanco y muestra las horas previstas', () => {
    const sheet = build([
      pendingShift('p1', '2026-09-30', { shiftObservation: 'Llevar llaves' }),
    ])
    expect(services(sheet).rows).toEqual([
      {
        key: 'service-p1',
        date: '30 sep 2026',
        client: 'Cliente Uno',
        site: 'Sede Uno',
        franja: '08:00–12:00',
        start: '',
        end: '',
        geo: '',
        novelty: 'Asignado, sin trabajar · Llevar llaves',
        hours: '(4 h)',
      },
    ])
  })

  it('una franja que cruza la medianoche calcula bien las horas previstas', () => {
    const sheet = build([
      pendingShift('p1', '2026-09-30', {
        startTime: '22:00:00',
        endTime: '06:00:00',
        endsAt: '2026-10-01T06:00:00-03:00',
      }),
    ])
    expect(services(sheet).rows[0]?.hours).toBe('(8 h)')
    expect(services(sheet).pendingMinutes).toBe(480)
  })

  it('un turno abierto va con «—» y no suma', () => {
    const sheet = build([
      pendingShift('p1', '2026-09-30', { openEnded: true, endsAt: null }),
    ])
    expect(services(sheet).rows[0]?.hours).toBe('—')
    expect(services(sheet).pendingMinutes).toBe(0)
    expect(services(sheet).pendingCount).toBe(1)
  })

  it('excluye cancelados, asignaciones quitadas, avisos de ausencia y franjas terminadas (que son inasistencias)', () => {
    const sheet = build([
      pendingShift('cancelado', '2026-09-30', { shiftStatus: 'cancelled' }),
      pendingShift('quitado', '2026-09-30', {
        removedAt: '2026-09-29T10:00:00-03:00',
      }),
      pendingShift('aviso', '2026-09-30', { status: 'absence_notified' }),
      pendingShift('terminado', '2026-09-29'),
    ])
    const keys = services(sheet).rows.map((row) => row.key)
    expect(keys).not.toContain('service-cancelado')
    expect(keys).not.toContain('service-quitado')
    expect(services(sheet).pendingCount).toBe(0)
    expect(services(sheet).footerRows).toBeUndefined()
    // El aviso y el terminado siguen entrando como inasistencias, no como pendientes.
    expect(sheet.facts.map((f) => f.label)).not.toContain(
      'Turnos asignados sin trabajar',
    )
    expect(sheet.notes).not.toContain(PENDING_SHEET_NOTE)
  })

  it('se intercalan por fecha y hora con lo trabajado', () => {
    const sheet = build(
      [
        makeAssignment({
          id: 'w1',
          shiftDate: '2026-09-29',
          checkInAt: '2026-09-29T08:01:00-03:00',
          checkOutAt: '2026-09-29T12:00:00-03:00',
          workedMinutes: 239,
        }),
        pendingShift('p2', '2026-10-01'),
        pendingShift('p1', '2026-09-30'),
      ],
      { to: '2026-10-01' },
    )
    expect(services(sheet).rows.map((row) => row.key)).toEqual([
      'service-w1',
      'service-p1',
      'service-p2',
    ])
  })

  it('con pendientes el pie lleva tres renglones, los datos suman N y va la nota', () => {
    const sheet = build([
      makeAssignment({
        id: 'w1',
        shiftDate: '2026-09-29',
        checkInAt: '2026-09-29T08:01:00-03:00',
        checkOutAt: '2026-09-29T12:00:00-03:00',
        workedMinutes: 240,
      }),
      pendingShift('p1', '2026-09-30'),
    ])
    const section = services(sheet)
    expect(section.footerRows).toEqual([
      { label: 'Horas trabajadas', value: '4 h' },
      { label: 'Asignadas sin trabajar (previstas)', value: '4 h' },
      { label: 'Total estimado del período', value: '8 h' },
    ])
    expect(section.footer).toEqual({
      label: 'Total estimado del período',
      value: '8 h',
    })
    // El total del modelo sigue siendo lo trabajado.
    expect(sheet.totalMinutes).toBe(240)
    expect(sheet.estimatedMinutes).toBe(480)
    expect(sheet.facts).toContainEqual({
      label: 'Turnos asignados sin trabajar',
      value: '1',
    })
    expect(sheet.notes).toContain(PENDING_SHEET_NOTE)
  })

  it('sin pendientes el pie queda como siempre', () => {
    const sheet = build([
      makeAssignment({
        id: 'w1',
        shiftDate: '2026-09-29',
        checkInAt: '2026-09-29T08:01:00-03:00',
        checkOutAt: '2026-09-29T12:00:00-03:00',
        workedMinutes: 240,
      }),
    ])
    expect(services(sheet).footerRows).toBeUndefined()
    expect(services(sheet).footer).toEqual({
      label: 'Total del período',
      value: '4 h',
    })
    expect(sheet.notes).toEqual([])
  })

  it('los pendientes no cuentan como fila real para el cierre automático ni en printableEntries', () => {
    const entries = buildAttendanceEntries([pendingShift('p1', '2026-09-30')])
    expect(printableEntries(entries, NOW)).toEqual([])
  })

  it('con los dos roles, rotula los totales y suma lo estimado con las jornadas registradas', () => {
    const sheet = build([pendingShift('p1', '2026-09-30')], {
      workdays: [makeWorkday({ workDate: '2026-09-30', workedMinutes: 60 })],
    })
    expect(services(sheet).footer.label).toBe('Total estimado como empleado')
    expect(sheet.grandTotal).toEqual({
      label: 'Total general estimado (empleado y coordinador)',
      value: '5 h',
    })
    expect(sheet.totalMinutes).toBe(60)
  })
})

describe('P36: filas en blanco de las jornadas del coordinador (D-08)', () => {
  const coordinator = { ...person, roleLabels: ['Coordinador'] }
  const workdaysSheet = (
    to: string,
    workdays = [] as ReturnType<typeof makeWorkday>[],
  ) =>
    buildAttendanceSheet({
      person: coordinator,
      from: '2026-09-01',
      to,
      entries: [],
      includeServices: false,
      workdays,
      now: NOW,
    })
  const section = (sheet: ReturnType<typeof buildAttendanceSheet>) => {
    const first = sheet.sections[0]
    if (!first) throw new Error('Sin sección de jornadas')
    return first
  }

  it('una fila «Sin registrar» por cada día desde hoy hasta «Hasta» que no tenga jornada', () => {
    const sheet = workdaysSheet('2026-10-02', [
      makeWorkday({
        workDate: '2026-10-01',
        startedAt: '2026-10-01T11:00:00Z',
      }),
    ])
    expect(
      section(sheet).rows.map((row) => [row.key, row.date, row.notes]),
    ).toEqual([
      ['workday-blank-2026-09-30', '30 sep 2026', 'Sin registrar'],
      ['workday-w1', '1 oct 2026', ''],
      ['supervision-sup1', '', ''],
      ['workday-blank-2026-10-02', '2 oct 2026', 'Sin registrar'],
    ])
    const blank = section(sheet).rows[0]
    expect(blank).toMatchObject({ start: '', end: '', pauses: '', hours: '' })
    expect(section(sheet).blankDaysCount).toBe(2)
    // El total y el dato «Jornadas» siguen siendo lo registrado.
    expect(sheet.totalMinutes).toBe(510)
    expect(sheet.facts).toContainEqual({ label: 'Jornadas', value: '1' })
    expect(sheet.notes).toContain(BLANK_WORKDAYS_SHEET_NOTE)
  })

  it('no genera filas si «Hasta» es anterior a hoy', () => {
    const sheet = workdaysSheet('2026-09-29')
    expect(section(sheet).rows).toEqual([])
    expect(sheet.notes).toEqual([])
  })

  it('si el período empieza después de hoy, arranca en «Desde»', () => {
    const sheet = buildAttendanceSheet({
      person: coordinator,
      from: '2026-10-02',
      to: '2026-10-03',
      entries: [],
      includeServices: false,
      workdays: [],
      now: NOW,
    })
    expect(section(sheet).rows.map((row) => row.key)).toEqual([
      'workday-blank-2026-10-02',
      'workday-blank-2026-10-03',
    ])
  })
})
