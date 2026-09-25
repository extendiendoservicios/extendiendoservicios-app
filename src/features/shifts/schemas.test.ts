import { describe, expect, it } from 'vitest'
import {
  shiftFormSchema,
  shiftFormValuesToCreateInput,
  shiftTimeFormSchema,
} from './schemas'

const VALID_VALUES = {
  clientId: 'c1',
  siteId: 'si1',
  date: '2026-10-05',
  startTime: '08:00',
  endTime: '12:00',
  requiredStaff: '2',
  notes: '',
}

describe('shiftFormSchema', () => {
  it('acepta un formulario válido', () => {
    const result = shiftFormSchema.safeParse(VALID_VALUES)
    expect(result.success).toBe(true)
  })

  it('rechaza cuando la hora de fin no es posterior a la de inicio', () => {
    const result = shiftFormSchema.safeParse({
      ...VALID_VALUES,
      startTime: '12:00',
      endTime: '08:00',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['endTime'])
    }
  })

  it('rechaza una dotación fuera de 1..10', () => {
    const result = shiftFormSchema.safeParse({
      ...VALID_VALUES,
      requiredStaff: '11',
    })
    expect(result.success).toBe(false)
  })

  it('rechaza una dotación no numérica', () => {
    const result = shiftFormSchema.safeParse({
      ...VALID_VALUES,
      requiredStaff: 'dos',
    })
    expect(result.success).toBe(false)
  })

  it('rechaza sin cliente ni sede', () => {
    const result = shiftFormSchema.safeParse({
      ...VALID_VALUES,
      clientId: '',
      siteId: '',
    })
    expect(result.success).toBe(false)
  })
})

describe('shiftFormValuesToCreateInput', () => {
  it('convierte la dotación a número y recorta las notas', () => {
    const input = shiftFormValuesToCreateInput({
      ...VALID_VALUES,
      notes: '  Llevar insumos propios  ',
    })
    expect(input).toEqual({
      clientId: 'c1',
      siteId: 'si1',
      date: '2026-10-05',
      start: '08:00',
      end: '12:00',
      requiredStaff: 2,
      notes: 'Llevar insumos propios',
    })
  })

  it('deja notas en null cuando viene vacío', () => {
    const input = shiftFormValuesToCreateInput(VALID_VALUES)
    expect(input.notes).toBeNull()
  })
})

describe('shiftTimeFormSchema', () => {
  it('acepta una franja válida', () => {
    const result = shiftTimeFormSchema.safeParse({
      startTime: '08:00',
      endTime: '12:00',
    })
    expect(result.success).toBe(true)
  })

  it('rechaza cuando la hora de fin no es posterior a la de inicio', () => {
    const result = shiftTimeFormSchema.safeParse({
      startTime: '12:00',
      endTime: '08:00',
    })
    expect(result.success).toBe(false)
  })
})
