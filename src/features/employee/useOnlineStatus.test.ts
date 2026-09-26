import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useOnlineStatus } from './useOnlineStatus'

describe('useOnlineStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('empieza con navigator.onLine', () => {
    vi.stubGlobal('navigator', { onLine: true })
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(true)
  })

  it('pasa a false cuando el navegador dispara "offline"', () => {
    vi.stubGlobal('navigator', { onLine: true })
    const { result } = renderHook(() => useOnlineStatus())

    act(() => {
      Object.defineProperty(window.navigator, 'onLine', {
        value: false,
        configurable: true,
      })
      window.dispatchEvent(new Event('offline'))
    })

    expect(result.current).toBe(false)
  })
})
