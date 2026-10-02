import { act, fireEvent, render, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEditingField } from './useEditingField'

function mockPointer(coarse: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('pointer: coarse') ? coarse : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useEditingField (RESP-008)', () => {
  it('es true mientras hay foco en un campo de texto en un dispositivo táctil', () => {
    mockPointer(true)
    const { container } = render(
      <div>
        <input aria-label="Nombre" />
        <button type="button">Guardar</button>
      </div>,
    )
    const { result } = renderHook(() => useEditingField())
    const input = container.querySelector('input')!

    expect(result.current).toBe(false)

    act(() => {
      fireEvent.focusIn(input)
    })
    expect(result.current).toBe(true)

    act(() => {
      fireEvent.focusOut(input, { relatedTarget: null })
    })
    expect(result.current).toBe(false)
  })

  it('el foco en un botón no cuenta como edición', () => {
    mockPointer(true)
    const { container } = render(<button type="button">Guardar</button>)
    const { result } = renderHook(() => useEditingField())

    act(() => {
      fireEvent.focusIn(container.querySelector('button')!)
    })
    expect(result.current).toBe(false)
  })

  it('con mouse (pointer: fine) nunca es true', () => {
    mockPointer(false)
    const { container } = render(<input aria-label="Nombre" />)
    const { result } = renderHook(() => useEditingField())

    act(() => {
      fireEvent.focusIn(container.querySelector('input')!)
    })
    expect(result.current).toBe(false)
  })
})
