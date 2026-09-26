import { describe, expect, it } from 'vitest'
import {
  checklistItemFormSchema,
  checklistItemFormValuesToInput,
} from './schemas'

describe('checklistItemFormSchema', () => {
  it('acepta un ítem válido', () => {
    const result = checklistItemFormSchema.safeParse({
      title: 'Barrer el salón',
      description: 'Incluye el depósito',
      isRequired: true,
    })
    expect(result.success).toBe(true)
  })

  it('rechaza un título vacío', () => {
    const result = checklistItemFormSchema.safeParse({
      title: '   ',
      description: '',
      isRequired: true,
    })
    expect(result.success).toBe(false)
  })

  it('rechaza un título de más de 200 caracteres', () => {
    const result = checklistItemFormSchema.safeParse({
      title: 'a'.repeat(201),
      isRequired: true,
    })
    expect(result.success).toBe(false)
  })
})

describe('checklistItemFormValuesToInput', () => {
  it('recorta el título y convierte la descripción vacía en null', () => {
    const input = checklistItemFormValuesToInput({
      title: '  Trapear  ',
      description: '   ',
      isRequired: false,
    })
    expect(input).toEqual({
      title: 'Trapear',
      description: null,
      isRequired: false,
    })
  })

  it('conserva una descripción con contenido', () => {
    const input = checklistItemFormValuesToInput({
      title: 'Trapear',
      description: 'Incluye pasillo',
      isRequired: true,
    })
    expect(input.description).toBe('Incluye pasillo')
  })
})
