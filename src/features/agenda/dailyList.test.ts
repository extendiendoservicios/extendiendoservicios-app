import { describe, expect, it } from 'vitest'
import type { AssignmentBoardRow } from '@/api/assignments'
import type {
  AgendaEmployeeColor,
  AgendaLeave,
  AgendaStaffLine,
  AgendaStaffMember,
} from '@/api/agenda'
import {
  buildDailyStaffList,
  formatEmployeeNumber,
  formatGroupRange,
  formatGroupTime,
  leaveDayNumber,
  leaveLineText,
  moveLine,
} from './dailyList'
import { buildWhatsAppText, keycapNumber } from './whatsappText'

function row(overrides: Partial<AssignmentBoardRow>): AssignmentBoardRow {
  return {
    id: 'a1',
    shiftId: 's1',
    shiftDate: '2026-11-16',
    shiftStatus: 'assigned',
    employeeId: 'e1',
    employeeFirstName: 'Ana',
    employeeLastName: 'Pérez',
    siteId: 'site1',
    siteName: 'Sede Centro',
    clientName: 'Cliente SA',
    clientId: 'c1',
    clientCalendarColor: null,
    startTime: '07:00:00',
    endTime: '11:00:00',
    openEnded: false,
    status: 'expected',
    notes: null,
    ...overrides,
  }
}

function member(
  profileId: string,
  employeeNumber: number,
  firstName: string,
  lastName: string,
  isCoordinator = false,
): AgendaStaffMember {
  return { profileId, employeeNumber, firstName, lastName, isCoordinator }
}

const staff = [
  member('betiana', 15, 'Betiana', 'Gimenez'),
  member('stella', 7, 'Stella', 'Lescano'),
  member('miguel', 2, 'Miguel', 'Caballini', true),
]

function build(overrides: {
  assignments?: AssignmentBoardRow[]
  observations?: Record<string, string>
  leaves?: AgendaLeave[]
  staffLines?: AgendaStaffLine[]
  colors?: AgendaEmployeeColor[]
}) {
  return buildDailyStaffList({
    day: '2026-11-16',
    staff,
    assignments: overrides.assignments ?? [],
    shiftObservations: overrides.observations ?? {},
    leaves: overrides.leaves ?? [],
    staffLines: overrides.staffLines ?? [],
    colors: overrides.colors ?? [],
  })
}

describe('lista diaria de la Agenda', () => {
  it('muestra el legajo con dos dígitos (tres si pasa de 99)', () => {
    expect(formatEmployeeNumber(2)).toBe('02')
    expect(formatEmployeeNumber(15)).toBe('15')
    expect(formatEmployeeNumber(105)).toBe('105')
  })

  it('arma las horas al estilo del grupo', () => {
    expect(formatGroupTime('07:00:00')).toBe('7')
    expect(formatGroupTime('09:15:00')).toBe('9:15')
    expect(formatGroupTime('12:15:00')).toBe('12:15')
    expect(formatGroupRange('07:00:00', '11:00:00', false)).toBe('7 A 11')
    expect(formatGroupRange('09:15:00', '12:15:00', false)).toBe('9:15 A 12:15')
    expect(formatGroupRange('07:00:00', '23:59:00', true)).toBe('DESDE 7')
  })

  it('incluye a todo el personal activo por legajo, tenga turno o no', () => {
    const list = build({})
    expect(list.map((entry) => entry.label)).toEqual([
      '02 Miguel Caballini',
      '07 Stella Lescano',
      '15 Betiana Gimenez',
    ])
    expect(list.every((entry) => entry.autoLines.length === 0)).toBe(true)
  })

  it('arma los turnos ordenados por hora, con la observación entre paréntesis', () => {
    const list = build({
      assignments: [
        row({
          id: 'a2',
          shiftId: 's2',
          employeeId: 'betiana',
          startTime: '09:15:00',
          endTime: '12:15:00',
          siteName: 'Mitre 589',
        }),
        row({
          id: 'a1',
          shiftId: 's1',
          employeeId: 'betiana',
          siteName: 'Florida 485',
          endTime: '09:00:00',
        }),
        row({
          id: 'a3',
          shiftId: 's3',
          employeeId: 'miguel',
          siteName: 'Merced 1358',
        }),
      ],
      observations: { s3: 'Vidrios' },
    })
    expect(list[2]?.autoLines.map((line) => line.text)).toEqual([
      '7 A 9 FLORIDA 485',
      '9:15 A 12:15 MITRE 589',
    ])
    expect(list[0]?.autoLines.map((line) => line.text)).toEqual([
      '7 A 11 MERCED 1358 (VIDRIOS)',
    ])
  })

  it('deja afuera los turnos cancelados y cuenta las otras personas del turno', () => {
    const list = build({
      assignments: [
        row({ id: 'a1', shiftId: 's1', employeeId: 'miguel' }),
        row({ id: 'a2', shiftId: 's1', employeeId: 'stella' }),
        row({
          id: 'a3',
          shiftId: 's9',
          employeeId: 'betiana',
          shiftStatus: 'cancelled',
        }),
      ],
    })
    expect(list[2]?.autoLines).toHaveLength(0)
    const line = list[0]?.autoLines[0]
    expect(line?.kind === 'shift' && line.otherPeopleCount).toBe(1)
  })

  it('la licencia dice el motivo y el número de día dentro de la licencia', () => {
    expect(leaveDayNumber('2026-11-16', '2026-11-16')).toBe(1)
    expect(leaveDayNumber('2026-11-10', '2026-11-16')).toBe(7)
    expect(leaveDayNumber('2026-10-30', '2026-11-02')).toBe(4)
    expect(
      leaveLineText(
        {
          employeeId: 'stella',
          startsOn: '2026-11-16',
          endsOn: null,
          reason: 'Vacaciones',
        },
        '2026-11-16',
      ),
    ).toBe('VACACIONES DIA 1')
  })

  it('pone las licencias primero, después los turnos y los renglones libres por posición', () => {
    const list = build({
      assignments: [row({ employeeId: 'stella', siteName: 'Sede' })],
      leaves: [
        {
          employeeId: 'stella',
          startsOn: '2026-11-16',
          endsOn: '2026-11-20',
          reason: 'Vacaciones',
        },
      ],
      staffLines: [
        {
          id: 'l2',
          employeeId: 'stella',
          day: '2026-11-16',
          body: 'B',
          position: 1,
        },
        {
          id: 'l1',
          employeeId: 'stella',
          day: '2026-11-16',
          body: 'A',
          position: 0,
        },
      ],
    })
    const stella = list[1]
    expect(stella?.autoLines.map((line) => line.kind)).toEqual([
      'leave',
      'shift',
    ])
    expect(stella?.freeLines.map((line) => line.body)).toEqual(['A', 'B'])
  })

  it('sube y baja un renglón sin salirse de los bordes', () => {
    expect(moveLine(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c'])
    expect(moveLine(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b'])
    expect(moveLine(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(moveLine(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
  })
})

describe('texto del parte para WhatsApp', () => {
  it('arma los números con emojis keycap', () => {
    expect(keycapNumber('02')).toBe('0️⃣2️⃣')
    expect(keycapNumber('15')).toBe('1️⃣5️⃣')
  })

  it('reproduce el formato del grupo', () => {
    const list = build({
      assignments: [
        row({
          id: 'a1',
          shiftId: 's1',
          employeeId: 'miguel',
          siteName: 'Merced 1358',
        }),
        row({
          id: 'a2',
          shiftId: 's2',
          employeeId: 'betiana',
          siteName: 'Florida 485',
          endTime: '09:00:00',
        }),
        row({
          id: 'a3',
          shiftId: 's3',
          employeeId: 'betiana',
          siteName: 'Mitre 589',
          startTime: '09:15:00',
          endTime: '12:15:00',
        }),
      ],
      observations: { s1: 'Vidrios' },
      colors: [
        {
          employeeId: 'miguel',
          borderColor: null,
          fillColor: null,
          fixedLine: 'VENTAS Y COORDINADOR DE TRABAJOS ESPECIALES',
        },
      ],
    }).filter((entry) => entry.employeeId !== 'stella')

    expect(buildWhatsAppText('2026-11-16', list)).toBe(
      [
        'LUNES 16 DE NOVIEMBRE',
        '👏 2 0 2 6 👏',
        '',
        '0️⃣2️⃣*MIGUEL CABALLINI*',
        'VENTAS Y COORDINADOR DE TRABAJOS ESPECIALES',
        '▪️7 A 11 MERCED 1358 (VIDRIOS)',
        '',
        '1️⃣5️⃣*BETIANA GIMENEZ*',
        '▪️7 A 9 FLORIDA 485',
        '▪️9:15 A 12:15 MITRE 589',
      ].join('\n'),
    )
  })

  it('suma licencias y renglones libres, y quien no tiene nada sale solo con el nombre', () => {
    const list = build({
      leaves: [
        {
          employeeId: 'stella',
          startsOn: '2026-11-16',
          endsOn: null,
          reason: 'Vacaciones',
        },
      ],
      staffLines: [
        {
          id: 'l1',
          employeeId: 'betiana',
          day: '2026-11-16',
          body: '11:20 UBER',
          position: 0,
        },
      ],
    })
    expect(buildWhatsAppText('2026-11-16', list)).toBe(
      [
        'LUNES 16 DE NOVIEMBRE',
        '👏 2 0 2 6 👏',
        '',
        '0️⃣2️⃣*MIGUEL CABALLINI*',
        '',
        '0️⃣7️⃣*STELLA LESCANO*',
        '▪️VACACIONES DIA 1',
        '',
        '1️⃣5️⃣*BETIANA GIMENEZ*',
        '▪️11:20 UBER',
      ].join('\n'),
    )
  })

  it('no incluye la jornada del coordinador', () => {
    const text = buildWhatsAppText('2026-11-16', build({}))
    expect(text).not.toMatch(/Jornada|Supervisi/i)
  })
})
