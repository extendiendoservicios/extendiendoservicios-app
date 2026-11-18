import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ADM-16 «Empleados · listado», OH-03: búsqueda, filtros, orden y página viven
 * en la dirección, así al volver de una ficha la lista queda como estaba.
 */

const { employeesQueryMock } = vi.hoisted(() => ({
  employeesQueryMock: vi.fn(),
}))

vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ roles: ['owner'], capabilities: [] }),
}))

vi.mock('@/features/employees/queries', () => ({
  useEmployeesQuery: employeesQueryMock,
  useEmployeeClientPermissionsQuery: () => ({ data: new Map() }),
  useEmployeeRatingsSummaryQuery: () => ({ data: new Map() }),
}))

vi.mock('@/features/sites/queries', () => ({
  useClientFilterOptionsQuery: () => ({ data: [] }),
}))

const { default: EmployeesPage } = await import('./EmployeesPage')

const EMPLOYEES = Array.from({ length: 45 }, (_, index) => ({
  profileId: `p${index + 1}`,
  employeeNumber: index + 1,
  firstName: `Nombre${index + 1}`,
  lastName: 'Apellido',
  avatarPath: null,
  phone: null,
  roles: ['employee'],
  effectiveStatus: 'active',
}))

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="url">{location.search}</p>
}

function renderPage(url = '/admin/empleados') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <EmployeesPage />
      <LocationProbe />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  employeesQueryMock.mockReset().mockReturnValue({
    data: EMPLOYEES,
    isLoading: false,
    dataUpdatedAt: 0,
  })
})

describe('EmployeesPage: estado en la dirección (OH-03)', () => {
  it('abre en la página de ?pagina= (al volver de una ficha no vuelve a la primera)', () => {
    renderPage('/admin/empleados?pagina=3')
    expect(
      screen.getByRole('link', { name: /Nombre41 Apellido.*Legajo 41$/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Nombre1 Apellido.*Legajo 1$/ }),
    ).not.toBeInTheDocument()
  })

  it('«Siguiente» escribe la página en la dirección', () => {
    renderPage()
    expect(
      screen.getByRole('link', { name: /Nombre1 Apellido.*Legajo 1$/ }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(screen.getByTestId('url').textContent).toBe('?pagina=2')
    expect(
      screen.getByRole('link', { name: /Nombre21 Apellido.*Legajo 21$/ }),
    ).toBeInTheDocument()
  })

  it('toma el texto, el rol y el estado de la dirección', () => {
    renderPage('/admin/empleados?q=ana&rol=supervisor&estado=on_leave')
    expect(employeesQueryMock).toHaveBeenCalledWith({
      text: 'ana',
      role: 'supervisor',
      status: 'on_leave',
    })
    expect(
      screen.getByPlaceholderText<HTMLInputElement>(
        'Buscar por nombre, DNI o legajo…',
      ).value,
    ).toBe('ana')
  })

  it('un valor inválido en la dirección cae en el filtro por defecto', () => {
    renderPage('/admin/empleados?rol=cualquiera&pagina=-4')
    expect(employeesQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'all' }),
    )
    expect(
      screen.getByRole('link', { name: /Nombre1 Apellido.*Legajo 1$/ }),
    ).toBeInTheDocument()
  })
})
