import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCurrentPositionSafe } from './geolocation'

/**
 * `geolocation.ts` (ATT-006): las cuatro situaciones de ADR-009. Ninguna
 * puede rechazar la promesa — `record_check_in`/`record_check_out` (P13.3)
 * siempre tienen que poder seguir sin ubicación.
 */

describe('getCurrentPositionSafe', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('devuelve las coordenadas cuando el navegador responde', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) =>
      success({
        coords: {
          latitude: -34.6,
          longitude: -58.4,
          accuracy: 12,
        },
      } as GeolocationPosition),
    )
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })

    const result = await getCurrentPositionSafe()

    expect(result).toEqual({ lat: -34.6, lng: -58.4, accuracyM: 12 })
  })

  it('devuelve null si el navegador no tiene geolocalización', async () => {
    vi.stubGlobal('navigator', {})

    const result = await getCurrentPositionSafe()

    expect(result).toBeNull()
  })

  it('devuelve null si la persona niega el permiso', async () => {
    const getCurrentPosition = vi.fn(
      (_success: PositionCallback, error: PositionErrorCallback) =>
        error({ code: 1, message: 'denegado' } as GeolocationPositionError),
    )
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })

    const result = await getCurrentPositionSafe()

    expect(result).toBeNull()
  })

  it('devuelve null si no responde antes del timeout propio', async () => {
    vi.useFakeTimers()
    // Nunca llama a ninguno de los dos callbacks: simula un navegador que se
    // queda esperando para siempre.
    const getCurrentPosition = vi.fn()
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })

    const promise = getCurrentPositionSafe(1_000)
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(promise).resolves.toBeNull()
  })

  it('devuelve null si la llamada a la API lanza de forma síncrona', async () => {
    const getCurrentPosition = vi.fn(() => {
      throw new Error('falla rara del navegador')
    })
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })

    const result = await getCurrentPositionSafe()

    expect(result).toBeNull()
  })
})
