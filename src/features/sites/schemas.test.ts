import { describe, expect, it } from 'vitest'
import { siteFormSchema, siteFormValuesToInput } from './schemas'

/**
 * Esquema de ADM-23 (SITE-001): repite a mano las restricciones del
 * servidor (`04_Modelo_de_Datos.md` sección 2.2) -- estos tests cubren esas
 * mismas reglas, no las del servidor (esas las vuelve a validar Postgres).
 */

describe('siteFormSchema', () => {
  const baseValues = {
    name: 'Sede Centro',
    address: 'Av. Siempre Viva 123',
    city: '',
    coordinates: null,
    contactName: '',
    contactPhone: '',
    accessInstructions: '',
    buildingHours: '',
    phoneRestricted: false,
    photosNotAllowed: false,
    restrictionsNotes: '',
    status: 'active' as const,
  }

  it('acepta una sede válida con solo nombre y dirección', () => {
    const result = siteFormSchema.safeParse(baseValues)
    expect(result.success).toBe(true)
  })

  it('rechaza el nombre vacío', () => {
    const result = siteFormSchema.safeParse({ ...baseValues, name: '  ' })
    expect(result.success).toBe(false)
  })

  it('rechaza la dirección vacía', () => {
    const result = siteFormSchema.safeParse({ ...baseValues, address: '  ' })
    expect(result.success).toBe(false)
  })

  it('acepta coordenadas nulas o un par lat/lng', () => {
    expect(
      siteFormSchema.safeParse({ ...baseValues, coordinates: null }).success,
    ).toBe(true)
    expect(
      siteFormSchema.safeParse({
        ...baseValues,
        coordinates: { lat: -34.6, lng: -58.4 },
      }).success,
    ).toBe(true)
  })
})

describe('siteFormValuesToInput', () => {
  it('recorta y convierte los campos de texto vacíos a null', () => {
    const input = siteFormValuesToInput({
      name: '  Sede Centro  ',
      address: '  Av. Siempre Viva 123  ',
      city: '   ',
      coordinates: null,
      contactName: '',
      contactPhone: undefined,
      accessInstructions: undefined,
      buildingHours: undefined,
      phoneRestricted: false,
      photosNotAllowed: true,
      restrictionsNotes: undefined,
      status: 'active',
    })
    expect(input).toEqual({
      name: 'Sede Centro',
      address: 'Av. Siempre Viva 123',
      city: null,
      latitude: null,
      longitude: null,
      contactName: null,
      contactPhone: null,
      accessInstructions: null,
      buildingHours: null,
      phoneRestricted: false,
      photosNotAllowed: true,
      restrictionsNotes: null,
      status: 'active',
    })
  })

  it('separa las coordenadas en latitude/longitude', () => {
    const input = siteFormValuesToInput({
      name: 'Sede Centro',
      address: 'Av. Siempre Viva 123',
      city: undefined,
      coordinates: { lat: -34.6, lng: -58.4 },
      contactName: undefined,
      contactPhone: undefined,
      accessInstructions: undefined,
      buildingHours: undefined,
      phoneRestricted: false,
      photosNotAllowed: false,
      restrictionsNotes: undefined,
      status: 'active',
    })
    expect(input.latitude).toBe(-34.6)
    expect(input.longitude).toBe(-58.4)
  })
})
