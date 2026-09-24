import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDebouncedValue } from './useDebouncedValue'

/**
 * `useDebouncedValue` (CLIENT-002, filtro de texto de ADM-19): devuelve el
 * valor anterior hasta que pasan `delayMs` sin que cambie.
 */
describe('useDebouncedValue', () => {
  it('arranca con el valor inicial', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 300))
    expect(result.current).toBe('a')
  })

  it('no actualiza el valor devuelto antes de que pase el retraso', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } },
    )
    rerender({ value: 'ab' })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current).toBe('a')
    vi.useRealTimers()
  })

  it('actualiza el valor devuelto una vez que pasa el retraso', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } },
    )
    rerender({ value: 'ab' })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current).toBe('ab')
    vi.useRealTimers()
  })

  it('reinicia el retraso si el valor vuelve a cambiar antes de que se cumpla', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } },
    )
    rerender({ value: 'ab' })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    rerender({ value: 'abc' })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current).toBe('a')
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current).toBe('abc')
    vi.useRealTimers()
  })
})
