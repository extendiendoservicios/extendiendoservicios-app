import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminShell } from './AdminShell'

// `AdminShell` lee `useAuth()` (nombre, rol, cerrar sesión): estos tests
// prueban el layout, no la sesión (eso lo cubre `AuthProvider.test.tsx`),
// así que alcanza con una sesión fija de administradora.
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    userId: 'user-1',
    email: 'andrea.rios@extendiendoservicios.com',
    roles: ['admin'],
    capabilities: [],
    profile: null,
    displayName: 'Andrea Ríos',
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  }),
}))

/**
 * Mismo criterio que `DataTable.test.tsx` (P05.3), pero resolviendo
 * `matches` según el `min-width` de cada consulta: `AdminShell` combina dos
 * quiebres a la vez (`1024px` sidebar/tabbar, `1280px` sidebar completa o
 * colapsada), así que un mock de un solo booleano no alcanza.
 */
function mockViewportWidth(widthPx: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const minWidthMatch = /min-width:\s*(\d+)px/.exec(query)
    const minWidth = minWidthMatch?.[1] ? Number(minWidthMatch[1]) : 0
    return {
      matches: widthPx >= minWidth,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }
  })
}

// `AdminShell` lee el título/subtítulo con `useRouteHandle` (`useMatches`),
// que solo existe dentro de un router de datos (`RouterProvider`) — un
// `<MemoryRouter><Routes>` simple no alcanza acá.
function renderAdminShell() {
  const router = createMemoryRouter(
    [
      {
        element: <AdminShell />,
        children: [
          {
            path: '/admin',
            element: <p>Resumen operativo</p>,
            handle: { screenId: 'ADM-02', title: 'Resumen' },
          },
        ],
      },
    ],
    { initialEntries: ['/admin'] },
  )
  return render(<RouterProvider router={router} />)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AdminShell — 1280 px o más', () => {
  it('muestra la sidebar completa (con las secciones) y sin tabbar', () => {
    mockViewportWidth(1440)
    renderAdminShell()

    expect(screen.getByText('Operación')).toBeInTheDocument()
    // "Configuración" es a la vez el encabezado de la sección y el único
    // ítem que tiene (`05_Pantallas_y_Navegacion.md` sección 2): las dos
    // apariciones son el comportamiento real, no una ambigüedad del test.
    expect(screen.getAllByText('Configuración')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Resumen' })).toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: 'Navegación principal' }),
    ).not.toBeInTheDocument()
  })

  it('muestra el lockup de marca sin nombre accesible duplicado (DS-018)', () => {
    mockViewportWidth(1440)
    renderAdminShell()

    // El texto visible "Extendiendo Servicios" es el único que aporta el
    // nombre accesible del link a /admin: la imagen del isotipo va con
    // `alt=""` (decorativa) para no anunciarse dos veces.
    expect(
      screen.getByRole('link', { name: /Extendiendo\s*Servicios/i }),
    ).toHaveAttribute('href', '/admin')
    expect(screen.queryByRole('img', { name: /./ })).not.toBeInTheDocument()
  })
})

describe('AdminShell — entre 1024 y 1279 px', () => {
  it('colapsa la sidebar a íconos (sin las etiquetas de sección) y sin tabbar', () => {
    mockViewportWidth(1100)
    renderAdminShell()

    expect(screen.queryByText('Operación')).not.toBeInTheDocument()
    // El ítem sigue siendo accesible por teclado y lector de pantalla
    // (aria-label), aunque no muestre el texto.
    expect(screen.getByRole('link', { name: 'Resumen' })).toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: 'Navegación principal' }),
    ).not.toBeInTheDocument()
  })

  it('colapsada, el isotipo lleva el nombre accesible de la marca (DS-018)', () => {
    mockViewportWidth(1100)
    renderAdminShell()

    // Sin el lockup de texto visible, la imagen es el único contenido del
    // link: ahí sí necesita un `alt` no vacío.
    expect(screen.queryByText(/Extendiendo Servicios/i)).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Extendiendo Servicios' }),
    ).toHaveAttribute('href', '/admin')
  })
})

describe('AdminShell — menos de 1024 px', () => {
  it('no muestra la sidebar y sí el tabbar inferior', () => {
    mockViewportWidth(390)
    renderAdminShell()

    expect(screen.queryByText('Operación')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Resumen' }),
    ).not.toBeInTheDocument()

    const tabbar = screen.getByRole('navigation', {
      name: 'Navegación principal',
    })
    expect(tabbar).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Hoy/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Planificar/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Más' })).toBeInTheDocument()
  })
})
