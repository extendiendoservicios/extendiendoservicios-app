import { fireEvent, render, screen, within } from '@testing-library/react'
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
        hasEmployeeRecord: true,
      },
      {
        profileId: 'p2',
        firstName: 'Beto',
        lastName: 'Ruiz',
        isActive: true,
        deletedAt: null,
        avatarPath: null,
        roles: ['admin'],
        hasEmployeeRecord: true,
      },
      {
        profileId: 'p3',
        firstName: 'Cuenta',
        lastName: 'Técnica',
        isActive: true,
        deletedAt: null,
        avatarPath: null,
        roles: ['owner'],
        hasEmployeeRecord: false,
      },
      {
        profileId: 'p4',
        firstName: 'Cami',
        lastName: 'Alvarez',
        isActive: false,
        deletedAt: '2026-09-01T00:00:00Z',
        avatarPath: null,
        roles: ['employee'],
        hasEmployeeRecord: true,
      },
    ],
  }),
  useLastSignInsQuery: () => ({ data: new Map() }),
  useUsersDirectoryQuery: () => ({
    data: new Map([
      ['p1', { employeeNumber: 12, dni: '30123456', email: 'ana@ejemplo.com' }],
      ['p2', { employeeNumber: 3, dni: '27111222', email: 'beto@ejemplo.com' }],
      ['p4', { employeeNumber: 7, dni: '25999888', email: null }],
    ]),
  }),
}))

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    // Escritorio: ni la consulta de tarjetas (táctil, OF-17) ni nada más angosto.
    matches: !query.includes('pointer: coarse'),
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

describe('UsersPage: buscador, orden y filtros (OG-12)', () => {
  function renderAt(url = '/') {
    return render(
      <MemoryRouter initialEntries={[url]}>
        <UsersPage />
      </MemoryRouter>,
    )
  }

  function names() {
    return screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[0]?.textContent)
  }

  it('ordena por legajo ascendente y deja al final a quien no tiene', () => {
    renderAt()
    expect(names()).toEqual(['Beto Ruiz', 'Ana Gómez', 'Cuenta Técnica'])
    expect(screen.getByText('3 de 4 usuarios')).toBeInTheDocument()
  })

  it('muestra la columna Legajo', () => {
    renderAt()
    expect(
      screen.getByRole('button', { name: 'Ordenar por legajo' }),
    ).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('el buscador filtra por apellido sin tildes, por DNI y por email', () => {
    renderAt()
    const search = screen.getByRole('searchbox', { name: 'Buscar usuarios' })
    fireEvent.change(search, { target: { value: 'gomez' } })
    expect(names()).toEqual(['Ana Gómez'])
    fireEvent.change(search, { target: { value: '30.123.456' } })
    expect(names()).toEqual(['Ana Gómez'])
    fireEvent.change(search, { target: { value: 'beto@' } })
    expect(names()).toEqual(['Beto Ruiz'])
    expect(screen.getByText('1 de 4 usuarios')).toBeInTheDocument()
  })

  it('el estado «Desactivados» y el filtro de rol se combinan', () => {
    renderAt()
    fireEvent.click(screen.getByRole('radio', { name: 'Desactivados' }))
    expect(names()).toEqual(['Cami Alvarez'])
    fireEvent.click(screen.getByRole('radio', { name: 'Todos' }))
    fireEvent.click(screen.getByRole('button', { name: 'Administración' }))
    expect(names()).toEqual(['Beto Ruiz'])
  })

  it('«Sin ficha laboral» deja a quien no tiene ficha', () => {
    renderAt()
    fireEvent.click(screen.getByRole('button', { name: 'Sin ficha laboral' }))
    expect(names()).toEqual(['Cuenta Técnica'])
  })

  it('lee la búsqueda y el orden de la dirección de la página', () => {
    renderAt('/?orden=nombre&dir=desc&estado=todos')
    expect(names()).toEqual([
      'Cuenta Técnica',
      'Beto Ruiz',
      'Ana Gómez',
      'Cami Alvarez',
    ])
  })

  it('tocar el encabezado Legajo invierte el orden', () => {
    renderAt()
    fireEvent.click(screen.getByRole('button', { name: 'Ordenar por legajo' }))
    expect(names()).toEqual(['Ana Gómez', 'Beto Ruiz', 'Cuenta Técnica'])
  })
})
