import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNow } from './useNow'

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-26T18:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('actualiza el reloj cada `intervalMs`', () => {
    const { result } = renderHook(() => useNow(1000))
    const initial = result.current.getTime()

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    // Alcanza con que haya avanzado al menos un intervalo: lo que importa es
    // que el reloj se mueva solo (no un valor exacto, sensible a cuántas
    // veces ya haya disparado el `setInterval` en este entorno de prueba).
    expect(result.current.getTime()).toBeGreaterThanOrEqual(initial + 1000)
  })
})
