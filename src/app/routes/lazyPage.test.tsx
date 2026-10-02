import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { lazyPage } from './lazyPage'

describe('lazyPage', () => {
  it('carga la pantalla bajo demanda y conserva el handle de la ruta', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/pantalla',
          ...lazyPage(() =>
            Promise.resolve({ default: () => <p>Pantalla cargada</p> }),
          ),
          handle: { screenId: 'X-02', title: 'Pantalla' },
        },
      ],
      { initialEntries: ['/pantalla'] },
    )
    render(<RouterProvider router={router} />)

    expect(await screen.findByText('Pantalla cargada')).toBeInTheDocument()
    expect(router.state.matches[0]?.route.handle).toEqual({
      screenId: 'X-02',
      title: 'Pantalla',
    })
  })
})
