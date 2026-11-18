import { act, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { useSearchParamState } from './useSearchParamState'

function Screen() {
  const [month, setMonth] = useSearchParamState('mes', '2026-11')
  const [page, setPage] = useSearchParamState('pagina', 1, {
    parse: (raw) => {
      const n = Number(raw)
      return Number.isInteger(n) && n > 0 ? n : undefined
    },
  })
  const location = useLocation()
  return (
    <div>
      <p data-testid="estado">{`${month}|${page}`}</p>
      <p data-testid="url">{location.pathname + location.search}</p>
      <button type="button" onClick={() => setMonth('2027-01')}>
        Enero
      </button>
      <button type="button" onClick={() => setMonth('2026-11')}>
        Noviembre
      </button>
      <button type="button" onClick={() => setPage((current) => current + 1)}>
        Siguiente
      </button>
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

describe('useSearchParamState (OH-03)', () => {
  it('usa el valor por defecto si la dirección no trae el parámetro', () => {
    renderAt('/lista')
    expect(screen.getByTestId('estado')).toHaveTextContent('2026-11|1')
  })

  it('lee el valor de la dirección y, si es inválido, cae al valor por defecto', () => {
    renderAt('/lista?mes=2027-02&pagina=abc')
    expect(screen.getByTestId('estado')).toHaveTextContent('2027-02|1')
  })

  it('escribe en la dirección con replace, sin sumar entradas al historial', () => {
    const router = renderAt('/lista')
    const before = router.state.historyAction
    fireEvent.click(screen.getByRole('button', { name: 'Enero' }))
    expect(screen.getByTestId('url')).toHaveTextContent('/lista?mes=2027-01')
    expect(screen.getByTestId('estado')).toHaveTextContent('2027-01|1')
    expect(before).not.toBe('PUSH')
    expect(router.state.historyAction).toBe('REPLACE')
    // Un solo «atrás» sale de la pantalla (no hay un paso por cada cambio).
    act(() => {
      void router.navigate(-1)
    })
    expect(router.state.location.pathname).toBe('/otra')
  })

  it('quita el parámetro cuando vuelve al valor por defecto y conserva los demás', () => {
    renderAt('/lista?mes=2027-01&otro=x')
    fireEvent.click(screen.getByRole('button', { name: 'Noviembre' }))
    expect(screen.getByTestId('url')).toHaveTextContent('/lista?otro=x')
  })

  it('acepta una función con el valor actual', () => {
    renderAt('/lista?pagina=2')
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(screen.getByTestId('url')).toHaveTextContent('/lista?pagina=3')
  })

  it('DEF-P30-01: dos cambios funcionales seguidos, sin esperar el render, suman los dos', () => {
    renderAt('/lista')
    const next = screen.getByRole('button', { name: 'Siguiente' })
    act(() => {
      fireEvent.click(next)
      fireEvent.click(next)
    })
    expect(screen.getByTestId('url')).toHaveTextContent('/lista?pagina=3')
    expect(screen.getByTestId('estado')).toHaveTextContent('2026-11|3')
  })
})
