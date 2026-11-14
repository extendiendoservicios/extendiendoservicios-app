import { fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileShell } from './MobileShell'

const rolesMock = vi.hoisted(() => ({ current: ['employee'] as string[] }))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    userId: 'user-1',
    email: 'ana@extendiendoservicios.com',
    roles: rolesMock.current,
    capabilities: [],
    profile: null,
    displayName: 'Ana Pérez',
    isPasswordRecovery: false,
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  }),
}))

vi.mock('@/features/auth/useBranding', () => ({
  useBranding: () => ({ status: 'ready', branding: null }),
  brandingLogoUrl: (path: string) => `https://ejemplo.test/${path}`,
}))

vi.mock('@/app/PwaUpdateProvider', () => ({
  usePwaUpdate: () => ({
    needRefresh: false,
    applying: false,
    applyUpdate: vi.fn(),
    postpone: vi.fn(),
  }),
}))

function renderShell(
  initialEntries: string[],
  variant: 'employee' | 'supervisor' = 'employee',
) {
  const router = createMemoryRouter(
    [
      {
        element: <MobileShell variant={variant} />,
        children: [
          { path: '/app', element: <p>Inicio</p> },
          {
            path: '/app/insumos',
            element: <p>Pantalla Insumos</p>,
            handle: { screenId: 'INS-01', title: 'Insumos' },
          },
          { path: '/sup', element: <p>Inicio sup</p> },
          {
            path: '/sup/insumos',
            element: <p>Insumos sup</p>,
            handle: { screenId: 'INS-01', title: 'Insumos' },
          },
          {
            path: '/app/mas',
            element: <p>Pantalla Más</p>,
            handle: { screenId: 'EMP-X', title: 'Más' },
          },
          {
            path: '/app/fichar',
            element: <p>Pantalla Fichar</p>,
            handle: { screenId: 'EMP-04', title: 'Fichar' },
          },
          {
            path: '/app/fichar/consentimiento',
            element: <p>Consentimiento</p>,
            handle: { screenId: 'EMP-05', title: 'Consentimiento' },
          },
        ],
      },
    ],
    { initialEntries, initialIndex: initialEntries.length - 1 },
  )
  return render(<RouterProvider router={router} />)
}

describe('MobileShell (P17.8)', () => {
  it('ocupa todo el ancho por debajo de 768 px y se centra a 480 px desde md', () => {
    const { container } = renderShell(['/app'])
    const column = container.querySelector('.min-h-dvh.w-full.flex-col')
    expect(column).not.toBeNull()
    expect(column).toHaveClass('md:max-w-[480px]')
    expect(column).not.toHaveClass('max-w-[480px]')
  })

  it('muestra la barra de marca con el nombre de la empresa', () => {
    const { container } = renderShell(['/app'])
    const bar = container.querySelector('[data-slot="brand-bar"]')
    expect(bar).not.toBeNull()
    expect(bar).toHaveTextContent('Extendiendo Servicios')
  })

  it('no hay flecha en las raíces del tabbar', () => {
    renderShell(['/app/mas'])
    expect(
      screen.queryByRole('button', { name: 'Volver' }),
    ).not.toBeInTheDocument()
  })

  it('sin historial, la flecha de una subpágina vuelve al padre lógico', () => {
    renderShell(['/app/fichar/consentimiento'])
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
    expect(screen.getByText('Pantalla Fichar')).toBeInTheDocument()
  })

  it('barra del empleado (IS-33): Hoy, Insumos, el botón Fichar y Más, en ese orden', () => {
    renderShell(['/app/insumos'])
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Hoy', 'Insumos', 'Más'])
    const order = Array.from(nav.querySelectorAll('a, button')).map(
      (element) => element.getAttribute('aria-label') ?? element.textContent,
    )
    expect(order).toEqual(['Hoy', 'Insumos', 'Fichar', 'Más'])
    expect(within(nav).getByRole('link', { name: 'Insumos' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('barra del coordinador (IS-33): Hoy, Supervisiones, Insumos, Historial y Más, sin Fichar', () => {
    renderShell(['/sup/insumos'], 'supervisor')
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Hoy', 'Supervisiones', 'Insumos', 'Historial', 'Más'])
    expect(
      within(nav).queryByRole('button', { name: 'Fichar' }),
    ).not.toBeInTheDocument()
  })
})

describe('MobileShell: «Volver al panel» (P29.2, OG-08)', () => {
  afterEach(() => {
    rolesMock.current = ['employee']
  })

  it('quien solo es empleado no ve el botón', () => {
    renderShell(['/app'])
    expect(
      screen.queryByRole('link', { name: 'Volver al panel' }),
    ).not.toBeInTheDocument()
  })

  it.each([['admin'], ['owner']])(
    'con rol %s además de empleado, el botón lleva siempre a /admin',
    (role) => {
      rolesMock.current = ['employee', role]
      renderShell(['/app'])
      expect(
        screen.getByRole('link', { name: 'Volver al panel' }),
      ).toHaveAttribute('href', '/admin')
    },
  )

  it('el botón también está en subpáginas y en la vía de coordinador', () => {
    rolesMock.current = ['admin', 'supervisor']
    renderShell(['/sup', '/sup/insumos'], 'supervisor')
    expect(
      screen.getByRole('link', { name: 'Volver al panel' }),
    ).toHaveAttribute('href', '/admin')
  })
})
