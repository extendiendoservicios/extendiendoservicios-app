import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COLOR_BY_STORAGE_KEY, readColorBy, useColorBy } from './colorBy'

describe('colorear por', () => {
  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('por defecto es «Estado»', () => {
    expect(readColorBy()).toBe('status')
    const { result } = renderHook(() => useColorBy())
    expect(result.current[0]).toBe('status')
  })

  it('recuerda la elección en localStorage', () => {
    const { result, unmount } = renderHook(() => useColorBy())
    act(() => result.current[1]('client'))
    expect(result.current[0]).toBe('client')
    expect(window.localStorage.getItem(COLOR_BY_STORAGE_KEY)).toBe('client')
    unmount()
    const again = renderHook(() => useColorBy())
    expect(again.result.current[0]).toBe('client')
  })

  it('un valor desconocido en el almacenamiento vuelve a «Estado»', () => {
    window.localStorage.setItem(COLOR_BY_STORAGE_KEY, 'otra-cosa')
    expect(readColorBy()).toBe('status')
  })

  it('si localStorage falla, no rompe y la elección vale en memoria', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('sin acceso')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('sin cuota')
    })
    const { result } = renderHook(() => useColorBy())
    expect(result.current[0]).toBe('status')
    act(() => result.current[1]('client'))
    expect(result.current[0]).toBe('client')
  })
})
