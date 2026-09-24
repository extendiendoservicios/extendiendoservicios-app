import { describe, expect, it } from 'vitest'
import {
  coordinatesEqual,
  formatCoordinate,
  isValidCoordinates,
  isValidLat,
  isValidLng,
  parseCoordinateInput,
} from './coordinates'

describe('isValidLat', () => {
  it('acepta el rango -90..90, límites incluidos', () => {
    expect(isValidLat(-90)).toBe(true)
    expect(isValidLat(90)).toBe(true)
    expect(isValidLat(0)).toBe(true)
  })

  it('rechaza fuera de rango y valores no finitos', () => {
    expect(isValidLat(-90.001)).toBe(false)
    expect(isValidLat(90.001)).toBe(false)
    expect(isValidLat(Number.NaN)).toBe(false)
  })
})

describe('isValidLng', () => {
  it('acepta el rango -180..180, límites incluidos', () => {
    expect(isValidLng(-180)).toBe(true)
    expect(isValidLng(180)).toBe(true)
  })

  it('rechaza fuera de rango', () => {
    expect(isValidLng(-180.001)).toBe(false)
    expect(isValidLng(180.001)).toBe(false)
  })
})

describe('isValidCoordinates', () => {
  it('exige los dos valores válidos a la vez', () => {
    expect(isValidCoordinates({ lat: -34.6, lng: -58.4 })).toBe(true)
    expect(isValidCoordinates({ lat: -95, lng: -58.4 })).toBe(false)
    expect(isValidCoordinates({ lat: -34.6, lng: -185 })).toBe(false)
  })
})

describe('parseCoordinateInput', () => {
  it('parsea un número con punto decimal', () => {
    expect(parseCoordinateInput('-34.6037')).toBe(-34.6037)
  })

  it('acepta coma decimal (teclado en español)', () => {
    expect(parseCoordinateInput('-34,6037')).toBe(-34.6037)
  })

  it('devuelve undefined para vacío o no numérico', () => {
    expect(parseCoordinateInput('')).toBeUndefined()
    expect(parseCoordinateInput('   ')).toBeUndefined()
    expect(parseCoordinateInput('no es un número')).toBeUndefined()
  })
})

describe('formatCoordinate', () => {
  it('redondea a seis decimales', () => {
    expect(formatCoordinate(-34.60376123456)).toBe('-34.603761')
  })
})

describe('coordinatesEqual', () => {
  it('compara por valor, no por referencia', () => {
    expect(coordinatesEqual({ lat: 1, lng: 2 }, { lat: 1, lng: 2 })).toBe(true)
    expect(coordinatesEqual({ lat: 1, lng: 2 }, { lat: 1, lng: 3 })).toBe(false)
  })

  it('trata null como igual solo a null', () => {
    expect(coordinatesEqual(null, null)).toBe(true)
    expect(coordinatesEqual(null, { lat: 1, lng: 2 })).toBe(false)
    expect(coordinatesEqual({ lat: 1, lng: 2 }, null)).toBe(false)
  })
})
