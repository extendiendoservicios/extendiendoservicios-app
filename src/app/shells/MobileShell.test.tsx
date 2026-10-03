import { fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { MobileShell } from './MobileShell'

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    userId: 'user-1',
    email: 'ana@extendiendoservicios.com',
    roles: ['employee'],
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

function renderShell(initialEntries: string[]) {
  const router = createMemoryRouter(
    [
      {
        element: <MobileShell variant="employee" />,
        children: [
          { path: '/app', element: <p>Inicio</p> },
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
})
