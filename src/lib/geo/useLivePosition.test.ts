import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLivePosition } from './useLivePosition'

/** Geolocalización simulada: el test dispara lecturas y errores a mano. */
function mockGeolocation() {
  let onSuccess: PositionCallback = () => {}
  let onError: PositionErrorCallback = () => {}
  const watchPosition = vi.fn(
    (success: PositionCallback, error?: PositionErrorCallback | null) => {
      onSuccess = success
      onError = error ?? (() => {})
      return 7
    },
  )
  const clearWatch = vi.fn()
  vi.stubGlobal('navigator', { geolocation: { watchPosition, clearWatch } })
  return {
    watchPosition,
    clearWatch,
    emit: (accuracy: number, lat = -34.6, lng = -58.4) =>
      onSuccess({
        coords: { latitude: lat, longitude: lng, accuracy },
        timestamp: Date.now(),
      } as GeolocationPosition),
    fail: (code: number) =>
      onError({ code, message: '' } as GeolocationPositionError),
  }
}

describe('useLivePosition', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('no pide nada si enabled es falso', () => {
    const geo = mockGeolocation()
    const { result } = renderHook(() => useLivePosition({ enabled: false }))
    expect(geo.watchPosition).not.toHaveBeenCalled()
    expect(result.current.state).toBe('idle')
    expect(result.current.position).toBeNull()
  })

  it('pasa de esperando a mejorando a lista y se queda con la mejor precisión', () => {
    const geo = mockGeolocation()
    const { result } = renderHook(() =>
      useLivePosition({ targetAccuracyM: 150 }),
    )
    expect(geo.watchPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ enableHighAccuracy: true }),
    )
    expect(result.current.state).toBe('waiting')

    act(() => geo.emit(400))
    expect(result.current.state).toBe('improving')
    expect(result.current.accuracyM).toBe(400)

    act(() => geo.emit(90))
    expect(result.current.state).toBe('ready')
    expect(result.current.accuracyM).toBe(90)

    // Una lectura peor no pisa la mejor, pero sí queda como última.
    act(() => geo.emit(300))
    expect(result.current.position?.accuracyM).toBe(90)
    expect(result.current.latest?.accuracyM).toBe(300)
    expect(result.current.state).toBe('ready')
  })

  it('permiso denegado: estado denied', () => {
    const geo = mockGeolocation()
    const { result } = renderHook(() => useLivePosition())
    act(() => geo.fail(1))
    expect(result.current.state).toBe('denied')
  })

  it('sin señal: unavailable; si después llega una lectura, se recupera', () => {
    const geo = mockGeolocation()
    const { result } = renderHook(() => useLivePosition())
    act(() => geo.fail(2))
    expect(result.current.state).toBe('unavailable')
    act(() => geo.emit(20))
    expect(result.current.state).toBe('ready')
  })

  it('un error pasajero con una lectura ya hecha no tira el estado', () => {
    const geo = mockGeolocation()
    const { result } = renderHook(() => useLivePosition())
    act(() => geo.emit(500))
    act(() => geo.fail(3))
    expect(result.current.state).toBe('improving')
  })

  it('sin API de geolocalización: unavailable, sin lanzar', () => {
    vi.stubGlobal('navigator', {})
    const { result } = renderHook(() => useLivePosition())
    expect(result.current.state).toBe('unavailable')
  })

  it('cuenta el tiempo transcurrido', () => {
    mockGeolocation()
    const { result } = renderHook(() => useLivePosition())
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(5000)
  })

  it('«Esperar mejor señal»: corre 30 s y vence', () => {
    const geo = mockGeolocation()
    const { result } = renderHook(() => useLivePosition())
    act(() => geo.emit(400))
    expect(result.current.wait).toBe('idle')

    act(() => result.current.startWait())
    expect(result.current.wait).toBe('running')
    expect(result.current.waitRemainingMs).toBe(30_000)

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(result.current.wait).toBe('running')
    expect(result.current.waitRemainingMs).toBeLessThanOrEqual(20_000)

    act(() => {
      vi.advanceTimersByTime(20_000)
    })
    expect(result.current.wait).toBe('expired')
    expect(result.current.waitRemainingMs).toBe(0)
  })

  it('la espera se corta sola si la precisión llega a lista', () => {
    const geo = mockGeolocation()
    const { result } = renderHook(() => useLivePosition())
    act(() => geo.emit(400))
    act(() => result.current.startWait())
    act(() => geo.emit(60))
    expect(result.current.wait).toBe('idle')
  })

  it('hace clearWatch al desmontar y al apagar enabled', () => {
    const geo = mockGeolocation()
    const { rerender, unmount } = renderHook(
      ({ enabled }) => useLivePosition({ enabled }),
      { initialProps: { enabled: true } },
    )
    rerender({ enabled: false })
    expect(geo.clearWatch).toHaveBeenCalledWith(7)

    rerender({ enabled: true })
    unmount()
    expect(geo.clearWatch).toHaveBeenCalledTimes(2)
  })
})
