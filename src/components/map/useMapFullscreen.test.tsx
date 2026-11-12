import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { supportsNativeFullscreen, useMapFullscreen } from './useMapFullscreen'

afterEach(() => {
  vi.restoreAllMocks()
})

function makeRef(el: HTMLElement | null) {
  return { current: el }
}

describe('supportsNativeFullscreen', () => {
  it('es falso sin elemento', () => {
    expect(supportsNativeFullscreen(null)).toBe(false)
  })

  it('es falso si el elemento no tiene requestFullscreen (iPhone Safari)', () => {
    const el = document.createElement('div')
    expect(supportsNativeFullscreen(el)).toBe(false)
  })

  it('es verdadero si existe requestFullscreen', () => {
    const el = document.createElement('div')
    el.requestFullscreen = vi.fn().mockResolvedValue(undefined)
    expect(supportsNativeFullscreen(el)).toBe(true)
  })
})

describe('useMapFullscreen', () => {
  it('sin la API nativa usa la alternativa CSS, y Esc sale', async () => {
    const el = document.createElement('div')
    const { result } = renderHook(() => useMapFullscreen(makeRef(el)))
    expect(result.current.active).toBe(false)

    await act(async () => {
      await result.current.toggle()
    })
    expect(result.current.overlayActive).toBe(true)
    expect(result.current.active).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(result.current.active).toBe(false)
    expect(document.body.style.overflow).toBe('')
  })

  it('el mismo botón sale de la alternativa CSS', async () => {
    const el = document.createElement('div')
    const { result } = renderHook(() => useMapFullscreen(makeRef(el)))
    await act(async () => {
      await result.current.toggle()
    })
    await act(async () => {
      await result.current.toggle()
    })
    expect(result.current.active).toBe(false)
  })

  it('con la API nativa pide pantalla completa sobre el contenedor', async () => {
    const el = document.createElement('div')
    const request = vi.fn().mockResolvedValue(undefined)
    el.requestFullscreen = request
    const { result } = renderHook(() => useMapFullscreen(makeRef(el)))
    await act(async () => {
      await result.current.toggle()
    })
    expect(request).toHaveBeenCalledOnce()
    expect(result.current.overlayActive).toBe(false)
  })

  it('si la API nativa falla, cae a la alternativa CSS', async () => {
    const el = document.createElement('div')
    el.requestFullscreen = vi.fn().mockRejectedValue(new Error('denegado'))
    const { result } = renderHook(() => useMapFullscreen(makeRef(el)))
    await act(async () => {
      await result.current.toggle()
    })
    expect(result.current.overlayActive).toBe(true)
  })
})
