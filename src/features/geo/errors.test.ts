import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/errors'
import { GEO_ERROR_MESSAGES, geoErrorMessage } from './errors'

/** Códigos que devuelven `correct_attendance_time`, `override_geo_validation`, `get_attendance_location` y `set_geofence_radius` (P22.1). */
const RPC_CODES = [
  'FORBIDDEN',
  'RECORD_NOT_FOUND',
  'SHIFT_CANCELLED',
  'REASON_REQUIRED',
  'TIME_REQUIRED',
  'AT_OUT_OF_RANGE',
  'SAME_TIME',
  'INVALID_TIME_RANGE',
  'INVALID_RECORD_TYPE',
  'GEO_ALREADY_VALID',
  'GEO_ALREADY_OVERRIDDEN',
  'RADIUS_OUT_OF_RANGE',
]

describe('geoErrorMessage', () => {
  it.each(RPC_CODES)('el código %s tiene mensaje propio en español', (code) => {
    expect(GEO_ERROR_MESSAGES[code]).toBeTruthy()
    const error = new ApiError('mensaje del servidor', code)
    expect(geoErrorMessage(error, 'respaldo')).toBe(GEO_ERROR_MESSAGES[code])
  })

  it('ningún mensaje queda en inglés ni vacío', () => {
    for (const message of Object.values(GEO_ERROR_MESSAGES)) {
      expect(message.length).toBeGreaterThan(10)
      expect(message).toMatch(/[.]$/)
    }
  })

  it('un código desconocido muestra el mensaje del servidor tal cual', () => {
    const error = new ApiError('Algo pasó en el servidor.', 'OTRO_CODIGO')
    expect(geoErrorMessage(error, 'respaldo')).toBe('Algo pasó en el servidor.')
  })

  it('un error sin código usa su mensaje', () => {
    expect(geoErrorMessage(new ApiError('Sin conexión.'), 'respaldo')).toBe(
      'Sin conexión.',
    )
  })

  it('un error que no es de la API usa el texto de respaldo', () => {
    expect(geoErrorMessage(new Error('boom'), 'No pudimos guardar.')).toBe(
      'No pudimos guardar.',
    )
    expect(geoErrorMessage(null, 'No pudimos guardar.')).toBe(
      'No pudimos guardar.',
    )
  })
})
