import { act, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUrlSearchText } from './useUrlSearchText'

function Screen() {
  const [text, setText] = useUrlSearchText()
  const location = useLocation()
  return (
    <div>
      <input
        aria-label="Buscar"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <p data-testid="url">{location.pathname + location.search}</p>
    </div>
  )
}

function renderAt(entry: string) {
  const router = createMemoryRouter([{ path: '/lista', element: <Screen /> }], {
    initialEntries: ['/otra', entry],
    initialIndex: 1,
  })
  render(<RouterProvider router={router} />)
  return router
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useUrlSearchText (OH-03)', () => {
  it('arranca con el texto de la dirección', () => {
    renderAt('/lista?q=limpieza')
    expect(screen.getByLabelText<HTMLInputElement>('Buscar').value).toBe(
      'limpieza',
    )
  })

  it('el campo responde al instante y la dirección se actualiza con antirrebote, sin apilar historial', () => {
    const router = renderAt('/lista?otro=1')
    const input = screen.getByLabelText<HTMLInputElement>('Buscar')
    fireEvent.change(input, { target: { value: 'ab' } })
    expect(input.value).toBe('ab')
    expect(screen.getByTestId('url').textContent).toBe('/lista?otro=1')
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(screen.getByTestId('url').textContent).toBe('/lista?otro=1&q=ab')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(router.state.location.key).not.toBe('default')
  })

  it('al borrar el texto quita el parámetro', () => {
    renderAt('/lista?q=abc')
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: '' } })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(screen.getByTestId('url').textContent).toBe('/lista')
  })

  it('sigue a la dirección cuando cambia desde afuera (atrás o adelante)', async () => {
    const router = renderAt('/lista?q=uno')
    await act(async () => {
      await router.navigate('/lista?q=dos')
    })
    expect(screen.getByLabelText<HTMLInputElement>('Buscar').value).toBe('dos')
  })
})
