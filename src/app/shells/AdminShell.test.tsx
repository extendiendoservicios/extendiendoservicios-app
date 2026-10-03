import { fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Branding } from '@/features/auth/useBranding'
import * as installPromptModule from '@/hooks/useInstallPrompt'
import { AdminShell } from './AdminShell'

const signOutMock = vi.hoisted(() => vi.fn())

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
    isPasswordRecovery: false,
    signOut: signOutMock,
    refreshProfile: vi.fn(),
  }),
}))

// `AdminShell` lee `useBranding()` (USERS-013, logo personalizado de la
// sidebar): sin este mock, el `useEffect` de ese hook dispara una consulta
// real a `v_public_branding` contra el proyecto falso de `vitest.config.ts`
// (mismo motivo que `LoginPage.test.tsx`, que mockea esto mismo). Por
// omisión no hay logo propio (isotipo de marca); el describe de USERS-013
// más abajo lo pisa con `mockReturnValueOnce` para probar el caso con logo.
const useBrandingMock = vi.fn<
  () => { status: 'ready'; branding: Branding | null }
>(() => ({ status: 'ready', branding: null }))
vi.mock('@/features/auth/useBranding', () => ({
  useBranding: () => useBrandingMock(),
  brandingLogoUrl: (path: string) =>
    `https://ejemplo.supabase.co/storage/v1/object/public/branding/${path}`,
}))

// `AdminShell` monta `PwaUpdateBanner` (RESP-009), que lee `usePwaUpdate()`:
// sin este mock, `AdminShell` termina importando (por la cadena de
// `PwaUpdateBanner` → `PwaUpdateProvider`) el módulo virtual
// `virtual:pwa-register/react`, que solo existe con el plugin de
// `vite-plugin-pwa` corriendo (no en `vitest.config.ts` — ver el comentario
// de `PwaUpdateProvider.test.tsx`). Ese aviso tiene su propia suite
// (`PwaUpdateBanner.test.tsx`, `PwaUpdateProvider.test.tsx`); acá alcanza
// con que no haya ninguna actualización pendiente.
vi.mock('@/app/PwaUpdateProvider', () => ({
  usePwaUpdate: () => ({
    needRefresh: false,
    applying: false,
    applyUpdate: vi.fn(),
    postpone: vi.fn(),
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
      // `display-mode: standalone` (app ya instalada) no es una consulta de
      // ancho: acá nunca coincide, para que `InstallBanner` pueda mostrarse.
      matches: query.includes('display-mode') ? false : widthPx >= minWidth,
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
function renderAdminShell(
  initialPath = '/admin',
  initialEntries: string[] = [initialPath],
) {
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
          {
            path: '/admin/empleados',
            element: <p>Listado de empleados</p>,
            handle: { screenId: 'ADM-14', title: 'Empleados' },
          },
          {
            path: '/admin/asistencia',
            element: <p>Asistencia de hoy</p>,
            handle: { screenId: 'ADM-10', title: 'Asistencia' },
          },
          {
            path: '/admin/planificacion',
            element: <p>Planificación</p>,
            handle: { screenId: 'ADM-05', title: 'Planificación' },
          },
          {
            path: '/admin/supervisiones',
            element: <p>Supervisiones</p>,
            handle: { screenId: 'ADM-13', title: 'Supervisiones' },
          },
          {
            path: '/admin/empleados/:id',
            element: <p>Ficha de empleado</p>,
            handle: { screenId: 'ADM-15', title: 'Ficha' },
          },
          {
            path: '/admin/configuracion/empresa',
            element: <p>Empresa</p>,
            handle: { screenId: 'ADM-28', title: 'Empresa' },
          },
        ],
      },
    ],
    { initialEntries, initialIndex: initialEntries.length - 1 },
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

describe('AdminShell — logo personalizado (USERS-013)', () => {
  it('muestra el logo de la empresa en vez del isotipo cuando hay uno cargado', () => {
    useBrandingMock.mockReturnValueOnce({
      status: 'ready',
      branding: {
        name: 'Limpiezas del Sur',
        logoPath: 'logo.png',
        supportPhone: null,
      },
    })
    mockViewportWidth(1440)
    renderAdminShell()

    const logo = screen.getByRole('img', { name: 'Limpiezas del Sur' })
    expect(logo).toHaveAttribute(
      'src',
      'https://ejemplo.supabase.co/storage/v1/object/public/branding/logo.png',
    )
  })

  it('sin logo cargado, sigue mostrando el isotipo de marca', () => {
    mockViewportWidth(1440)
    renderAdminShell()

    expect(screen.queryByRole('img', { name: /./ })).not.toBeInTheDocument()
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

  it('"Más" abre el menú con el resto de las secciones, así todas quedan alcanzables', () => {
    mockViewportWidth(390)
    renderAdminShell()

    fireEvent.click(screen.getByRole('button', { name: 'Más' }))

    const menu = screen.getByRole('navigation', { name: 'Más secciones' })
    const hrefs = Array.from(menu.querySelectorAll('a')).map((a) =>
      a.getAttribute('href'),
    )
    expect(hrefs).toEqual([
      '/admin/empleados',
      '/admin/clientes',
      '/admin/tareas',
      '/admin/configuracion/usuarios',
    ])
  })

  it('las ocho secciones de P-121 se alcanzan entre la tabbar y "Más"', () => {
    mockViewportWidth(390)
    renderAdminShell()

    // Antes de abrir el menú: el diálogo marca el resto de la página como
    // oculta para la tecnología asistiva y ya no se la puede consultar.
    const tabbar = screen.getByRole('navigation', {
      name: 'Navegación principal',
    })
    const tabbarHrefs = Array.from(tabbar.querySelectorAll('a')).map((a) =>
      a.getAttribute('href'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Más' }))

    const sections = [
      ...tabbarHrefs,
      ...Array.from(
        screen
          .getByRole('navigation', { name: 'Más secciones' })
          .querySelectorAll('a'),
      ).map((a) => a.getAttribute('href')),
    ].map((href) => href?.split('?')[0])
    expect(sections).toEqual([
      '/admin',
      '/admin/planificacion',
      '/admin/asistencia',
      '/admin/supervisiones',
      '/admin/empleados',
      '/admin/clientes',
      '/admin/tareas',
      '/admin/configuracion/usuarios',
    ])
  })

  it('"Más" se marca activo cuando la pantalla es una de sus secciones', () => {
    mockViewportWidth(390)
    renderAdminShell('/admin/empleados')

    expect(screen.getByRole('button', { name: 'Más' }).className).toContain(
      'text-primary',
    )
    expect(screen.getByRole('link', { name: /Hoy/ }).className).not.toContain(
      'text-primary',
    )
  })

  it('la tabbar crece con el área segura (RESP-008)', () => {
    mockViewportWidth(390)
    renderAdminShell()

    expect(
      screen.getByRole('navigation', { name: 'Navegación principal' }),
    ).toHaveClass('tabbar-safe')
  })
})

describe('AdminShell — banner de instalación (COM-06)', () => {
  function mockInstallable() {
    vi.spyOn(installPromptModule, 'useInstallPrompt').mockReturnValue({
      available: true,
      promptInstall: vi.fn(),
    })
  }

  afterEach(() => {
    window.localStorage.clear()
  })

  it('aparece en el inicio de administración en celular', () => {
    mockViewportWidth(390)
    mockInstallable()
    renderAdminShell('/admin')

    expect(screen.getByText('Instalá la aplicación')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Instalar' })).toBeInTheDocument()
  })

  it('no aparece en otras pantallas de administración', () => {
    mockViewportWidth(390)
    mockInstallable()
    renderAdminShell('/admin/asistencia')

    expect(screen.queryByText('Instalá la aplicación')).not.toBeInTheDocument()
  })

  it('no aparece en escritorio (1024 px o más)', () => {
    mockViewportWidth(1440)
    mockInstallable()
    renderAdminShell('/admin')

    expect(screen.queryByText('Instalá la aplicación')).not.toBeInTheDocument()
  })

  it('"Ahora no" lo oculta', () => {
    mockViewportWidth(390)
    mockInstallable()
    renderAdminShell('/admin')

    fireEvent.click(screen.getByRole('button', { name: 'Ahora no' }))

    expect(screen.queryByText('Instalá la aplicación')).not.toBeInTheDocument()
  })
})

describe('AdminShell — flecha atrás (P17.8)', () => {
  const backName = { name: 'Volver' }

  it.each([
    '/admin',
    '/admin/planificacion',
    '/admin/asistencia',
    '/admin/supervisiones',
  ])('no hay flecha en la raíz del tabbar %s', (path) => {
    mockViewportWidth(390)
    renderAdminShell(path)

    expect(screen.queryByRole('button', backName)).not.toBeInTheDocument()
  })

  it.each([
    '/admin/empleados',
    '/admin/empleados/123',
    '/admin/configuracion/empresa',
  ])('hay flecha en %s (sección de Más o detalle)', (path) => {
    mockViewportWidth(390)
    renderAdminShell(path)

    expect(screen.getByRole('button', backName)).toBeInTheDocument()
  })

  it('con historial, vuelve a la pantalla anterior', () => {
    mockViewportWidth(390)
    renderAdminShell('/admin/asistencia', [
      '/admin/asistencia',
      '/admin/empleados/123',
    ])

    fireEvent.click(screen.getByRole('button', backName))

    expect(screen.getByText('Asistencia de hoy')).toBeInTheDocument()
  })

  it('sin historial (entrada directa), un detalle vuelve a su listado', () => {
    mockViewportWidth(390)
    renderAdminShell('/admin/empleados/123')

    fireEvent.click(screen.getByRole('button', backName))

    expect(screen.getByText('Listado de empleados')).toBeInTheDocument()
  })

  it('sin historial, una sección de Más vuelve al inicio', () => {
    mockViewportWidth(390)
    renderAdminShell('/admin/empleados')

    fireEvent.click(screen.getByRole('button', backName))

    expect(screen.getByText('Resumen operativo')).toBeInTheDocument()
  })

  it('en compu (1024 px o más) también hay flecha, salvo en las raíces', () => {
    mockViewportWidth(1440)
    const { unmount } = renderAdminShell('/admin/empleados/123')
    expect(screen.getByRole('button', backName)).toBeInTheDocument()
    unmount()

    renderAdminShell('/admin/planificacion')
    expect(screen.queryByRole('button', backName)).not.toBeInTheDocument()
  })
})

describe('AdminShell — barra de marca y Más en celular (P17.8)', () => {
  it('muestra la barra de marca solo por debajo de 1024 px', () => {
    mockViewportWidth(390)
    const mobile = renderAdminShell()
    expect(
      mobile.container.querySelector('[data-slot="brand-bar"]'),
    ).not.toBeNull()
    mobile.unmount()

    mockViewportWidth(1440)
    const desktop = renderAdminShell()
    expect(
      desktop.container.querySelector('[data-slot="brand-bar"]'),
    ).toBeNull()
  })

  it('"Cerrar sesión" está en el menú Más y cierra la sesión', () => {
    mockViewportWidth(390)
    renderAdminShell()

    fireEvent.click(screen.getByRole('button', { name: 'Más' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))

    expect(signOutMock).toHaveBeenCalledTimes(1)
  })
})
