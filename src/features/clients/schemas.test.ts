import { describe, expect, it } from 'vitest'
import {
  clientContactFormSchema,
  clientContactFormValuesToInput,
  clientFormSchema,
  clientFormValuesToInput,
} from './schemas'

/**
 * Esquemas de ADM-20 y del panel de contactos de ADM-21 (CLIENT-001):
 * repiten a mano las restricciones del servidor (`04_Modelo_de_Datos.md`
 * sección 2.2) -- estos tests cubren esas mismas reglas, no las del
 * servidor (esas las vuelve a validar Postgres).
 */

describe('clientFormSchema', () => {
  const baseValues = {
    legalName: 'Limpiadora SRL',
    tradeName: '',
    cuit: '',
    adminAddress: '',
    coordinates: null,
    status: 'active' as const,
    notes: '',
  }

  it('acepta un cliente válido sin CUIT', () => {
    const result = clientFormSchema.safeParse(baseValues)
    expect(result.success).toBe(true)
  })

  it('rechaza la razón social vacía', () => {
    const result = clientFormSchema.safeParse({ ...baseValues, legalName: '' })
    expect(result.success).toBe(false)
  })

  it('acepta un CUIT de 11 dígitos', () => {
    const result = clientFormSchema.safeParse({
      ...baseValues,
      cuit: '20123456786',
    })
    expect(result.success).toBe(true)
  })

  it.each(['2012345678', '201234567861', '20-12345678-6', 'abcdefghijk'])(
    'rechaza un CUIT con formato inválido (%s)',
    (cuit) => {
      const result = clientFormSchema.safeParse({ ...baseValues, cuit })
      expect(result.success).toBe(false)
    },
  )

  it('acepta coordenadas nulas o un par lat/lng', () => {
    expect(
      clientFormSchema.safeParse({ ...baseValues, coordinates: null }).success,
    ).toBe(true)
    expect(
      clientFormSchema.safeParse({
        ...baseValues,
        coordinates: { lat: -34.6, lng: -58.4 },
      }).success,
    ).toBe(true)
  })
})

describe('clientFormValuesToInput', () => {
  it('recorta y convierte los campos de texto vacíos a null', () => {
    const input = clientFormValuesToInput({
      legalName: '  Limpiadora SRL  ',
      tradeName: '   ',
      cuit: '  ',
      adminAddress: '',
      coordinates: null,
      status: 'active',
      notes: undefined,
    })
    expect(input).toEqual({
      legalName: 'Limpiadora SRL',
      tradeName: null,
      cuit: null,
      adminAddress: null,
      latitude: null,
      longitude: null,
      status: 'active',
      notes: null,
    })
  })

  it('separa las coordenadas en latitude/longitude', () => {
    const input = clientFormValuesToInput({
      legalName: 'Limpiadora SRL',
      tradeName: undefined,
      cuit: undefined,
      adminAddress: undefined,
      coordinates: { lat: -34.6, lng: -58.4 },
      status: 'active',
      notes: undefined,
    })
    expect(input.latitude).toBe(-34.6)
    expect(input.longitude).toBe(-58.4)
  })
})

describe('clientContactFormSchema', () => {
  const baseContact = {
    name: 'Ana Gómez',
    roleTitle: '',
    phone: '',
    email: '',
    isPrimary: false,
  }

  it('acepta un contacto sin email', () => {
    expect(clientContactFormSchema.safeParse(baseContact).success).toBe(true)
  })

  it('rechaza el nombre vacío', () => {
    expect(
      clientContactFormSchema.safeParse({ ...baseContact, name: '  ' }).success,
    ).toBe(false)
  })

  it('rechaza un email con formato inválido', () => {
    expect(
      clientContactFormSchema.safeParse({
        ...baseContact,
        email: 'no-es-un-email',
      }).success,
    ).toBe(false)
  })

  it('acepta un email válido', () => {
    expect(
      clientContactFormSchema.safeParse({
        ...baseContact,
        email: 'ana@ejemplo.com',
      }).success,
    ).toBe(true)
  })
})

describe('clientContactFormValuesToInput', () => {
  it('recorta y convierte los campos vacíos a null', () => {
    const input = clientContactFormValuesToInput({
      name: '  Ana Gómez  ',
      roleTitle: '',
      phone: '   ',
      email: '',
      isPrimary: true,
    })
    expect(input).toEqual({
      name: 'Ana Gómez',
      roleTitle: null,
      phone: null,
      email: null,
      isPrimary: true,
    })
  })
})
