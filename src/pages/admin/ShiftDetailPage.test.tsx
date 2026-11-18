import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

/**
 * ADM-06, OH-03: cerrar el detalle del turno vuelve al calendario tal como
 * estaba (con su mes y sus filtros en la dirección), no al mes actual.
 */

vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true }))
vi.mock('@/features/planning/components/ShiftDetail', () => ({
  ShiftDetail: () => <p>Contenido del turno</p>,
}))
vi.mock('@/features/shifts/components/DeleteShiftAction', () => ({
  DeleteShiftAction: () => null,
}))

const { default: ShiftDetailPage } = await import('./ShiftDetailPage')

function Calendario() {
  const location = useLocation()
  return <p data-testid="calendario">{`Calendario${location.search}`}</p>
}

function renderAt(entries: string[], index: number) {
  const router = createMemoryRouter(
    [
      { path: '/admin/planificacion', element: <Calendario /> },
      { path: '/admin/turnos/:id', element: <ShiftDetailPage /> },
    ],
    { initialEntries: entries, initialIndex: index },
  )
  render(<RouterProvider router={router} />)
  return router
}

describe('ShiftDetailPage: volver al lugar donde se estaba (OH-03)', () => {
  it('al cerrar vuelve al calendario con el mes y los filtros de antes', async () => {
    const router = renderAt(
      [
        '/admin/planificacion?vista=mes&mes=2026-12&cliente=c1',
        '/admin/turnos/s1',
      ],
      1,
    )
    await screen.findByText('Contenido del turno')
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    })
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/admin/planificacion'),
    )
    expect(router.state.location.search).toBe(
      '?vista=mes&mes=2026-12&cliente=c1',
    )
  })

  it('si se entró directo por la dirección, cierra al calendario', async () => {
    const router = renderAt(['/admin/turnos/s1'], 0)
    await screen.findByText('Contenido del turno')
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    })
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/admin/planificacion'),
    )
  })
})
