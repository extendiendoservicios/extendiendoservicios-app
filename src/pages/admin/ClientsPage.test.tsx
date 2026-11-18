import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientListRow } from '@/api/clients'
import { COLLAPSED_GROUPS_STORAGE_KEY } from '@/features/clients/useCollapsedGroups'

/**
 * ADM-19 «Clientes · listado»: OH-14 (categorías que se contraen, con el estado
 * recordado en el navegador) y OH-03 (búsqueda y filtros en la dirección).
 */

const { clientsQueryMock } = vi.hoisted(() => ({ clientsQueryMock: vi.fn() }))

vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ roles: ['owner'], capabilities: [] }),
}))

vi.mock('@/features/clients/queries', () => ({
  useClientsQuery: clientsQueryMock,
  usePrimaryContactNamesQuery: () => ({ data: new Map() }),
  useClientsWorkedMinutesQuery: () => ({ data: new Map() }),
}))

vi.mock('@/features/clients/categoryQueries', () => ({
  useActiveClientsCountQuery: () => ({ data: 3 }),
  useClientCategoriesQuery: () => ({
    data: [
      { id: 'cat-1', name: 'Oficinas', sortOrder: 1 },
      { id: 'cat-2', name: 'Consorcios', sortOrder: 2 },
    ],
  }),
}))

vi.mock('@/features/sites/queries', () => ({
  useClientFilterOptionsQuery: () => ({ data: [] }),
  useSitesMapQuery: () => ({ data: [] }),
}))

vi.mock('@/features/geo/queries', () => ({
  useCompanyGeofenceQuery: () => ({ data: undefined }),
}))

vi.mock('@/features/employees/employeeLeaveStatus', () => ({
  todayInBuenosAires: () => '2026-11-18',
}))

vi.mock('@/components/map', () => ({ MapView: () => <div /> }))

const { default: ClientsPage } = await import('./ClientsPage')

function client(overrides: Partial<ClientListRow>): ClientListRow {
  return {
    id: 'c1',
    legalName: 'Razón SA',
    tradeName: 'Cliente',
    cuit: null,
    status: 'active',
    sitesCount: 1,
    activeServicesCount: 1,
    photoPath: null,
    categoryId: 'cat-1',
    categoryName: 'Oficinas',
    ...overrides,
  }
}

const CLIENTS: ClientListRow[] = [
  client({ id: 'c1', tradeName: 'Banco Sur' }),
  client({ id: 'c2', tradeName: 'Estudio Norte' }),
  client({
    id: 'c3',
    tradeName: 'Edificio Mitre',
    categoryId: 'cat-2',
    categoryName: 'Consorcios',
  }),
]

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="url">{location.search}</p>
}

function renderPage(url = '/admin/clientes') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ClientsPage />
      <LocationProbe />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  clientsQueryMock.mockReset().mockReturnValue({
    data: CLIENTS,
    isLoading: false,
    dataUpdatedAt: 0,
  })
})

describe('ClientsPage: categorías que se contraen (OH-14)', () => {
  it('cada categoría lleva un botón con su nombre, el número de clientes y aria-expanded', () => {
    renderPage()
    const oficinas = screen.getByRole('button', { name: /Oficinas/ })
    expect(oficinas).toHaveAttribute('aria-expanded', 'true')
    expect(within(oficinas).getByText('2')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Banco Sur/ })).toBeInTheDocument()
  })

  it('tocar el nombre contrae el listado de esa categoría y vuelve a desplegarlo', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Oficinas/ }))
    expect(screen.getByRole('button', { name: /Oficinas/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(
      screen.queryByRole('link', { name: /Banco Sur/ }),
    ).not.toBeInTheDocument()
    // Las otras categorías siguen a la vista.
    expect(
      screen.getByRole('link', { name: /Edificio Mitre/ }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Oficinas/ }))
    expect(screen.getByRole('link', { name: /Banco Sur/ })).toBeInTheDocument()
  })

  it('«Contraer todo» y «Desplegar todo» actúan sobre todas las categorías', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Contraer todo' }))
    expect(
      screen.queryByRole('link', { name: /Banco Sur/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Edificio Mitre/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Contraer todo' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Desplegar todo' }))
    expect(screen.getByRole('link', { name: /Banco Sur/ })).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Edificio Mitre/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Desplegar todo' }),
    ).toBeDisabled()
  })

  it('recuerda lo contraído en el navegador', () => {
    const { unmount } = renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Consorcios/ }))
    expect(
      JSON.parse(
        window.localStorage.getItem(COLLAPSED_GROUPS_STORAGE_KEY) ?? '[]',
      ),
    ).toEqual(['cat-2'])
    unmount()

    renderPage()
    expect(screen.getByRole('button', { name: /Consorcios/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(
      screen.queryByRole('link', { name: /Edificio Mitre/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Banco Sur/ })).toBeInTheDocument()
  })

  it('anda igual si el almacenamiento falla', () => {
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('cuota')
      })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Oficinas/ }))
    expect(
      screen.queryByRole('link', { name: /Banco Sur/ }),
    ).not.toBeInTheDocument()
    spy.mockRestore()
  })

  it('en celular (tarjetas) también se contrae', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Oficinas/ }))
    expect(
      screen.queryByRole('link', { name: /Estudio Norte/ }),
    ).not.toBeInTheDocument()
  })
})

describe('ClientsPage: filtros en la dirección (OH-03)', () => {
  it('toma estado y categoría de la dirección', () => {
    renderPage('/admin/clientes?estado=suspended&categoria=cat-2')
    expect(clientsQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'suspended', categoryId: 'cat-2' }),
    )
  })

  it('sin parámetros muestra solo activos y todas las categorías', () => {
    renderPage()
    expect(clientsQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active', categoryId: 'all' }),
    )
  })

  it('un estado inválido en la dirección cae en «activos»', () => {
    renderPage('/admin/clientes?estado=cualquiera')
    expect(clientsQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' }),
    )
  })

  it('el buscador toma el texto de ?q=', () => {
    renderPage('/admin/clientes?q=banco')
    expect(
      screen.getByPlaceholderText<HTMLInputElement>('Buscar por nombre o CUIT…')
        .value,
    ).toBe('banco')
  })
})
