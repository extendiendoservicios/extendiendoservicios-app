import { describe, expect, it } from 'vitest'
import type { AgendaItem } from '@/api/agenda'
import {
  buildAgendaGrid,
  daysWithEvents,
  eventSummary,
  groupNewBySlot,
  monthStartIso,
} from './agendaMonth'

function item(overrides: Partial<AgendaItem>): AgendaItem {
  return {
    id: 'i',
    kind: 'evento',
    month: '2026-11-01',
    day: null,
    slot: null,
    position: 0,
    workType: null,
    timeText: null,
    place: null,
    clientPerson: null,
    people: null,
    placeName: null,
    clientName: null,
    address: null,
    daysHours: null,
    budget: null,
    observation: null,
    body: null,
    resolved: false,
    borderColor: null,
    fillColor: null,
    fillBeforeResolved: null,
    clientId: null,
    ...overrides,
  }
}

describe('grilla del mes de la Agenda', () => {
  it('arma semanas de lunes a domingo con el número de día automático', () => {
    const weeks = buildAgendaGrid(2026, 11, [])
    // Noviembre de 2026 empieza un domingo: la primera semana arranca el lunes 26 de octubre.
    expect(weeks[0]?.[0]?.date).toBe('2026-10-26')
    expect(weeks[0]?.[6]?.date).toBe('2026-11-01')
    expect(weeks.every((week) => week.length === 7)).toBe(true)
    expect(weeks[0]?.[0]?.isCurrentMonth).toBe(false)
    expect(weeks[0]?.[6]?.dayNumber).toBe(1)
    expect(weeks[0]?.[6]?.isCurrentMonth).toBe(true)
  })

  it('pone cada evento en su día y marca los feriados', () => {
    const items = [
      item({ id: 'a', day: '2026-11-03', workType: 'Reunión' }),
      item({ id: 'b', day: '2026-11-03', workType: 'Turno' }),
      item({ id: 'c', day: '2026-11-20', workType: 'Final de obra' }),
    ]
    const weeks = buildAgendaGrid(
      2026,
      11,
      items,
      new Map([['2026-11-23', 'Día de la Soberanía Nacional']]),
    )
    const days = weeks.flat()
    expect(days.find((d) => d.date === '2026-11-03')?.events).toHaveLength(2)
    expect(days.find((d) => d.date === '2026-11-20')?.events).toHaveLength(1)
    const holiday = days.find((d) => d.date === '2026-11-23')
    expect(holiday?.isHoliday).toBe(true)
    expect(holiday?.holidayName).toBe('Día de la Soberanía Nacional')
    expect(days.find((d) => d.date === '2026-11-24')?.isHoliday).toBe(false)
  })

  it('muestra hasta el máximo y cuenta el «+N» del resto', () => {
    const items = Array.from({ length: 5 }, (_, index) =>
      item({ id: `e${index}`, day: '2026-11-10', workType: `E${index}` }),
    )
    const day = buildAgendaGrid(2026, 11, items)
      .flat()
      .find((d) => d.date === '2026-11-10')
    expect(day?.shownEvents).toHaveLength(3)
    expect(day?.hiddenCount).toBe(2)
  })

  it('no pone eventos en los días de los meses vecinos', () => {
    const items = [item({ day: '2026-10-30', workType: 'Otro mes' })]
    const day = buildAgendaGrid(2026, 11, items)
      .flat()
      .find((d) => d.date === '2026-10-30')
    expect(day?.events).toHaveLength(0)
  })

  it('lista los días con eventos en orden para el celular', () => {
    const items = [
      item({ id: 'b', day: '2026-11-20', workType: 'B' }),
      item({ id: 'a', day: '2026-11-03', workType: 'A' }),
      item({ id: 'n', kind: 'nota', body: 'Nota' }),
    ]
    expect(daysWithEvents(items).map((d) => d.date)).toEqual([
      '2026-11-03',
      '2026-11-20',
    ])
  })

  it('reparte los nuevos en siete columnas', () => {
    const columns = groupNewBySlot([
      item({ id: 'x', kind: 'nuevo', slot: 0, placeName: 'X' }),
      item({ id: 'y', kind: 'nuevo', slot: 6, placeName: 'Y' }),
      item({ id: 'z', kind: 'nuevo', slot: 6, placeName: 'Z' }),
    ])
    expect(columns).toHaveLength(7)
    expect(columns[0]).toHaveLength(1)
    expect(columns[6]?.map((i) => i.id)).toEqual(['y', 'z'])
    expect(columns[3]).toHaveLength(0)
  })

  it('resume un evento y arma el primer día del mes', () => {
    expect(
      eventSummary(
        item({ timeText: '08:00', workType: 'Reunión', place: 'Oficina' }),
      ),
    ).toBe('08:00 · Reunión · Oficina')
    expect(eventSummary(item({ observation: 'Llevar llaves' }))).toBe(
      'Llevar llaves',
    )
    expect(monthStartIso(2026, 3)).toBe('2026-03-01')
  })
})
