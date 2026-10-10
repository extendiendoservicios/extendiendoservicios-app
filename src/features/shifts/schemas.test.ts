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
      openEnded: false,
      requiredStaff: 2,
      notes: 'Llevar insumos propios',
      showInPrint: true,
    })
  })

  it('AJ2-15: la casilla «mostrar en la impresión» va tildada por defecto y respeta si se destilda', () => {
    expect(shiftFormValuesToCreateInput(VALID_VALUES).showInPrint).toBe(true)
    expect(
      shiftFormValuesToCreateInput({ ...VALID_VALUES, showInPrint: false })
        .showInPrint,
    ).toBe(false)
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

describe('AJ2-10: turnos «A terminar»', () => {
  it('con «A terminar» no pide hora de fin ni la compara con el inicio', () => {
    const result = shiftFormSchema.safeParse({
      ...VALID_VALUES,
      endTime: '',
      openEnded: true,
    })
    expect(result.success).toBe(true)
    const early = shiftFormSchema.safeParse({
      ...VALID_VALUES,
      startTime: '12:00',
      endTime: '08:00',
      openEnded: true,
    })
    expect(early.success).toBe(true)
  })

  it('con «A terminar» el inicio no puede ser 23:59', () => {
    const result = shiftFormSchema.safeParse({
      ...VALID_VALUES,
      startTime: '23:59',
      endTime: '',
      openEnded: true,
    })
    expect(result.success).toBe(false)
  })

  it('sin «A terminar» la hora de fin sigue siendo obligatoria', () => {
    const result = shiftFormSchema.safeParse({
      ...VALID_VALUES,
      endTime: '',
      openEnded: false,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Falta la hora de fin.')
    }
  })

  it('el alta manda fin null y openEnded', () => {
    const input = shiftFormValuesToCreateInput({
      ...VALID_VALUES,
      endTime: '',
      openEnded: true,
    })
    expect(input.end).toBeNull()
    expect(input.openEnded).toBe(true)
  })

  it('la edición puede pasar a «A terminar» y volver a ponerle fin', () => {
    const toOpen = shiftEditFormSchema.safeParse({
      startTime: '08:00',
      endTime: '',
      openEnded: true,
      requiredStaff: '2',
    })
    expect(toOpen.success).toBe(true)
    const back = shiftEditFormValuesToInputs({
      startTime: '08:00',
      endTime: '12:00',
      openEnded: false,
      requiredStaff: '2',
    })
    expect(back.time).toEqual({
      start: '08:00',
      end: '12:00',
      openEnded: false,
    })
    const open = shiftEditFormValuesToInputs({
      startTime: '08:00',
      endTime: '',
      openEnded: true,
      requiredStaff: '2',
    })
    expect(open.time).toEqual({ start: '08:00', end: null, openEnded: true })
  })

  it('la franja del turno también admite «A terminar»', () => {
    expect(
      shiftTimeFormSchema.safeParse({
        startTime: '08:00',
        endTime: '',
        openEnded: true,
      }).success,
    ).toBe(true)
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
      time: { start: '08:00', end: '12:00', openEnded: false },
      details: { requiredStaff: 4, notes: 'Llevar insumos', showInPrint: true },
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
