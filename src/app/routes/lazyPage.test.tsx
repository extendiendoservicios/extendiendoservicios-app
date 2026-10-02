import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lazyPage, reloadAfterChunkError } from './lazyPage'

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

describe('reloadAfterChunkError', () => {
  afterEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('recarga una sola vez dentro de la ventana', () => {
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      reload,
    })
    expect(reloadAfterChunkError()).toBe(true)
    expect(reloadAfterChunkError()).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
