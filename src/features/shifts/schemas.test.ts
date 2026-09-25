import { describe, expect, it } from 'vitest'
import {
  shiftEditFormSchema,
  shiftEditFormValuesToInputs,
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

describe('shiftEditFormSchema', () => {
  const VALID_EDIT_VALUES = {
    startTime: '08:00',
    endTime: '12:00',
    requiredStaff: '3',
    notes: '',
  }

  it('acepta franja, dotación y notas válidas', () => {
    const result = shiftEditFormSchema.safeParse(VALID_EDIT_VALUES)
    expect(result.success).toBe(true)
  })

  it('rechaza una dotación fuera de 1..10', () => {
    const result = shiftEditFormSchema.safeParse({
      ...VALID_EDIT_VALUES,
      requiredStaff: '0',
    })
    expect(result.success).toBe(false)
  })
})

describe('shiftEditFormValuesToInputs', () => {
  it('separa la franja de la dotación y las notas, y recorta el texto', () => {
    const inputs = shiftEditFormValuesToInputs({
      startTime: '08:00',
      endTime: '12:00',
      requiredStaff: '4',
      notes: '  Llevar insumos  ',
    })
    expect(inputs).toEqual({
      time: { start: '08:00', end: '12:00' },
      details: { requiredStaff: 4, notes: 'Llevar insumos' },
    })
  })

  it('deja notas en null cuando viene vacío', () => {
    const inputs = shiftEditFormValuesToInputs({
      startTime: '08:00',
      endTime: '12:00',
      requiredStaff: '4',
      notes: '',
    })
    expect(inputs.details.notes).toBeNull()
  })
})
