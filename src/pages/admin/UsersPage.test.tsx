import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UsersPage from './UsersPage'

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ roles: ['owner'], capabilities: [], userId: 'o1' }),
}))

vi.mock('@/features/settings/components/ConfigNav', () => ({
  ConfigNav: () => null,
}))

vi.mock('@/features/users/components/UserActionsMenu', () => ({
  UserActionsMenu: () => <button type="button">Acciones</button>,
}))
vi.mock('@/features/users/components/NewAdminUserSheet', () => ({
  NewAdminUserSheet: () => null,
}))
vi.mock('@/features/users/components/RolesCapabilitiesSheet', () => ({
  RolesCapabilitiesSheet: () => null,
}))

// Radix no monta la <img> hasta que carga: se verifica el `avatarSrc` que recibe.
vi.mock('@/components/PersonCell', () => ({
  PersonCell: ({
    name,
    avatarSrc,
  }: {
    name: string
    avatarSrc?: string | null
  }) => <span data-avatar-src={avatarSrc ?? ''}>{name}</span>,
}))

vi.mock('@/lib/avatarUrl', () => ({
  avatarUrl: (path: string) => `https://storage.test/${path}`,
}))

vi.mock('@/features/users/queries', () => ({
  useUsersQuery: () => ({
    isLoading: false,
    dataUpdatedAt: 0,
    data: [
      {
        profileId: 'p1',
        firstName: 'Ana',
        lastName: 'Gómez',
        isActive: true,
        deletedAt: null,
        avatarPath: 'p1/foto.jpg',
        roles: ['employee'],
      },
      {
        profileId: 'p2',
        firstName: 'Beto',
        lastName: 'Ruiz',
        isActive: true,
        deletedAt: null,
        avatarPath: null,
        roles: ['admin'],
      },
    ],
  }),
  useLastSignInsQuery: () => ({ data: new Map() }),
}))

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
})

describe('UsersPage: fotos y clic a la ficha (AJ2-11, AJ2-12)', () => {
  it('quien tiene ficha de empleado lleva a /admin/empleados/:id y los administradores sin ficha no navegan', () => {
    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    )
    const links = screen.getAllByRole('link')
    const hrefs = links.map((link) => link.getAttribute('href'))
    expect(hrefs).toContain('/admin/empleados/p1')
    expect(hrefs).not.toContain('/admin/empleados/p2')
    expect(links.some((link) => within(link).queryByText('Beto Ruiz'))).toBe(
      false,
    )
  })

  it('muestra la foto de la persona que la tiene', () => {
    const { container } = render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    )
    expect(
      container.querySelector(
        '[data-avatar-src="https://storage.test/p1/foto.jpg"]',
      ),
    ).not.toBeNull()
    expect(screen.getByText('Beto Ruiz')).toHaveAttribute('data-avatar-src', '')
  })
})
