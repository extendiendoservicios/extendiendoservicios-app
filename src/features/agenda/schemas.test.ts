import { describe, expect, it } from 'vitest'
import {
  agendaEventSchema,
  agendaNewSchema,
  agendaNoteSchema,
  formatBudget,
  parseBudget,
} from './schemas'

const emptyEvent = {
  workType: '',
  timeText: '',
  place: '',
  clientPerson: '',
  people: '',
  observation: '',
  day: '2026-11-10',
  borderColor: null,
  fillColor: null,
}

describe('esquemas de la Agenda', () => {
  it('no deja guardar un evento vacío, pero sí con un solo dato', () => {
    expect(agendaEventSchema.safeParse(emptyEvent).success).toBe(false)
    expect(
      agendaEventSchema.safeParse({ ...emptyEvent, place: 'Oficina' }).success,
    ).toBe(true)
  })

  it('exige el día del evento', () => {
    expect(
      agendaEventSchema.safeParse({ ...emptyEvent, place: 'x', day: '' })
        .success,
    ).toBe(false)
  })

  it('valida el presupuesto y que el bloque no quede vacío', () => {
    const base = {
      placeName: '',
      clientName: '',
      address: '',
      daysHours: '',
      budget: '',
      observation: '',
      slot: 0,
      borderColor: null,
      fillColor: null,
    }
    expect(agendaNewSchema.safeParse(base).success).toBe(false)
    expect(agendaNewSchema.safeParse({ ...base, budget: 'abc' }).success).toBe(
      false,
    )
    expect(
      agendaNewSchema.safeParse({ ...base, budget: '1.500,50' }).success,
    ).toBe(true)
  })

  it('la nota lleva entre 1 y 1000 caracteres', () => {
    const note = { borderColor: null, fillColor: null }
    expect(agendaNoteSchema.safeParse({ ...note, body: '  ' }).success).toBe(
      false,
    )
    expect(
      agendaNoteSchema.safeParse({ ...note, body: 'a'.repeat(1001) }).success,
    ).toBe(false)
    expect(
      agendaNoteSchema.safeParse({ ...note, body: 'Llamar' }).success,
    ).toBe(true)
  })

  it('interpreta importes escritos a la argentina', () => {
    expect(parseBudget('1.250,50')).toBe(1250.5)
    expect(parseBudget('$ 1500')).toBe(1500)
    expect(parseBudget('1.500')).toBe(1500)
    expect(parseBudget('12,5')).toBe(12.5)
    expect(parseBudget('-3')).toBeNull()
    expect(parseBudget('')).toBeNull()
    expect(formatBudget(1250.5)).toBe('1.250,50')
    expect(formatBudget(null)).toBe('')
  })
})
