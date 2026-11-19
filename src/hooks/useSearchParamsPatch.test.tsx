import { fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { useSearchParamsPatch } from './useSearchParamsPatch'

function Screen() {
  const [values, update] = useSearchParamsPatch({
    desde: '2026-11-01',
    cliente: 'all',
    sede: 'all',
  })
  const location = useLocation()
  return (
    <div>
      <p data-testid="valores">{`${values.desde}|${values.cliente}|${values.sede}`}</p>
      <p data-testid="url">{location.pathname + location.search}</p>
      <button
        type="button"
        onClick={() =>
          update({ cliente: 'c1', sede: 'all', desde: '2026-10-01' })
        }
      >
        Cambiar varios
      </button>
      <button type="button" onClick={() => update({ cliente: 'all' })}>
        Volver al valor por defecto
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

describe('useSearchParamsPatch (OH-03)', () => {
  it('lee los valores por defecto y los de la dirección', () => {
    renderAt('/lista?sede=s9')
    expect(screen.getByTestId('valores').textContent).toBe('2026-11-01|all|s9')
  })

  it('cambia varios parámetros en una sola navegación, conserva los ajenos y no apila historial', () => {
    const router = renderAt('/lista?pestana=consumo&sede=s9')
    fireEvent.click(screen.getByText('Cambiar varios'))
    expect(screen.getByTestId('valores').textContent).toBe('2026-10-01|c1|all')
    expect(screen.getByTestId('url').textContent).toBe(
      '/lista?pestana=consumo&cliente=c1&desde=2026-10-01',
    )
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('quita el parámetro cuando vuelve a su valor por defecto', () => {
    renderAt('/lista?cliente=c1')
    fireEvent.click(screen.getByText('Volver al valor por defecto'))
    expect(screen.getByTestId('url').textContent).toBe('/lista')
  })
})
