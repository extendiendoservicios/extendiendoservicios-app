import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAddressSearch } from './useAddressSearch'

describe('useAddressSearch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('marca error sin llamar a fetch si la búsqueda está vacía', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAddressSearch())

    await act(async () => {
      await result.current.search()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.errorMessage).toMatch(/Escribí una dirección/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('busca y guarda los resultados', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            lat: '-34.6037',
            lon: '-58.3816',
            display_name: 'Av. Centenario 1450, San Isidro',
          },
        ]),
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAddressSearch())

    act(() => result.current.setQuery('Av. Centenario 1450'))
    await act(async () => {
      await result.current.search()
    })

    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.results).toHaveLength(1)
    expect(result.current.results[0]?.displayName).toBe(
      'Av. Centenario 1450, San Isidro',
    )
  })

  it('avisa cuando no hay resultados', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAddressSearch())

    act(() => result.current.setQuery('dirección que no existe'))
    await act(async () => {
      await result.current.search()
    })

    expect(result.current.status).toBe('success')
    expect(result.current.results).toHaveLength(0)
    expect(result.current.errorMessage).toMatch(/No se encontró/)
  })

  it('reset() vuelve al estado inicial', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          { lat: '-34.6', lon: '-58.4', display_name: 'Algún lugar' },
        ]),
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAddressSearch())

    act(() => result.current.setQuery('algún lugar'))
    await act(async () => {
      await result.current.search()
    })
    act(() => result.current.reset())

    expect(result.current.status).toBe('idle')
    expect(result.current.results).toHaveLength(0)
    expect(result.current.errorMessage).toBeNull()
  })
})
