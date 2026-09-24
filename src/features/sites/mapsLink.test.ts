import { describe, expect, it } from 'vitest'
import { buildMapsUrl } from './mapsLink'

describe('buildMapsUrl', () => {
  it('con coordenadas, arma la búsqueda por lat/lng', () => {
    const url = buildMapsUrl({
      latitude: -34.6,
      longitude: -58.4,
      address: 'Av. Siempre Viva 123',
      city: 'CABA',
    })
    expect(url).toBe(
      'https://www.google.com/maps/search/?api=1&query=-34.6,-58.4',
    )
  })

  it('sin coordenadas, arma la búsqueda por dirección y localidad', () => {
    const url = buildMapsUrl({
      latitude: null,
      longitude: null,
      address: 'Av. Siempre Viva 123',
      city: 'CABA',
    })
    expect(url).toBe(
      'https://www.google.com/maps/search/?api=1&query=Av.%20Siempre%20Viva%20123%2C%20CABA',
    )
  })

  it('sin coordenadas ni localidad, arma la búsqueda solo con la dirección', () => {
    const url = buildMapsUrl({
      latitude: null,
      longitude: null,
      address: 'Av. Siempre Viva 123',
      city: null,
    })
    expect(url).toBe(
      'https://www.google.com/maps/search/?api=1&query=Av.%20Siempre%20Viva%20123',
    )
  })
})
