import { fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { BackLink } from './BackLink'

function Where() {
  const { pathname, search } = useLocation()
  return <p data-testid="donde">{pathname + search}</p>
}

function renderAt(entries: string[]) {
  const router = createMemoryRouter(
    [
      { path: '/admin/clientes', element: <Where /> },
      {
        path: '/admin/clientes/5',
        element: (
          <>
            <Where />
            <BackLink fallback="/admin/clientes">Volver a Clientes</BackLink>
          </>
        ),
      },
    ],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  )
  render(<RouterProvider router={router} />)
  return router
}

describe('BackLink (OH-03)', () => {
  it('vuelve a la página anterior, con su dirección completa, si se llegó desde la app', () => {
    const router = renderAt([
      '/admin/clientes?categoria=3',
      '/admin/clientes/5',
    ])
    fireEvent.click(screen.getByRole('link', { name: 'Volver a Clientes' }))
    expect(router.state.location.pathname + router.state.location.search).toBe(
      '/admin/clientes?categoria=3',
    )
  })

  it('si se entró directo, va a la ruta de respaldo', () => {
    const router = renderAt(['/admin/clientes/5'])
    expect(
      screen.getByRole('link', { name: 'Volver a Clientes' }),
    ).toHaveAttribute('href', '/admin/clientes')
    fireEvent.click(screen.getByRole('link', { name: 'Volver a Clientes' }))
    expect(router.state.location.pathname).toBe('/admin/clientes')
  })
})
