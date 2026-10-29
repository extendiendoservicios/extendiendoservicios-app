import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EmployeeDetailPage from './EmployeeDetailPage'

/**
 * P26.2b: el bloque principal de ADM-17 muestra las filas de acceso solo a
 * quien puede verlas y el botón de arriba dice «Cambiar contraseña». Se
 * mockean las consultas y las pestañas (tienen su propia cobertura).
 */
const { authState } = vi.hoisted(() => ({
  authState: {
    current: {
      roles: ['owner'],
      capabilities: [] as string[],
      userId: 'u-owner',
    },
  },
}))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => authState.current,
}))

const baseEmployee = {
  profileId: 'p1',
  firstName: 'Lucía',
  lastName: 'Torres',
  employeeNumber: 12,
  effectiveStatus: 'active',
  roles: ['employee'],
  avatarPath: null,
  dni: '30111222',
  cuil: null,
  phone: null,
  address: null,
  birthDate: null,
}

const { employeeState } = vi.hoisted(() => ({
  employeeState: { current: null as object | null },
}))

vi.mock('@/features/employees/queries', () => ({
  useEmployeeDetailQuery: () => ({
    isLoading: false,
    data: employeeState.current,
  }),
  useEmployeeRatingsSummaryQuery: () => ({ data: new Map() }),
}))

vi.mock('@/features/bank/queries', () => ({
  useEmployeeBankDetailsQuery: () => ({ data: null, isLoading: false }),
}))

vi.mock('@/features/users/components/AccessBlock', () => ({
  AccessBlock: (props: { showChangePassword?: boolean }) => (
    <div data-testid="access-rows">
      {props.showChangePassword === false ? 'sin-cambiar' : 'con-cambiar'}
    </div>
  ),
}))

vi.mock('@/features/bank/components/BankDetailsCard', () => ({
  BankDetailsCard: () => null,
}))
vi.mock('@/features/employees/components/EmployeeAccountDialogs', () => ({
  ResetEmployeePasswordDialog: () => null,
  SignOutEmployeeDialog: () => null,
  TerminateEmployeeDialog: () => null,
}))
vi.mock('@/features/employees/components/EmployeeRolesDialog', () => ({
  EmployeeRolesDialog: () => null,
}))
vi.mock('@/features/employees/components/RatingSummary', () => ({
  RatingSummary: () => null,
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/empleados/p1']}>
      <Routes>
        <Route path="/admin/empleados/:id" element={<EmployeeDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  authState.current = { roles: ['owner'], capabilities: [], userId: 'u-owner' }
  employeeState.current = baseEmployee
})

describe('EmployeeDetailPage · acceso en el bloque principal', () => {
  it('muestra las filas de acceso en el bloque principal, sin «Poner una nueva» ni «Cambiar» propios (showChangePassword en false), y el botón de arriba dice «Cambiar contraseña»', () => {
    renderPage()
    expect(screen.getByTestId('access-rows')).toHaveTextContent('sin-cambiar')
    expect(
      screen.getByRole('button', { name: 'Cambiar contraseña' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Resetear contraseña' }),
    ).not.toBeInTheDocument()
  })

  it('un administrador sin manage_users no ve las filas y el bloque queda como antes', () => {
    authState.current = {
      roles: ['admin'],
      capabilities: [],
      userId: 'u-admin',
    }
    renderPage()
    expect(screen.queryByTestId('access-rows')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Lucía Torres' }),
    ).toBeInTheDocument()
  })
})

describe('EmployeeDetailPage · ficha de un dueño o administrador (CR-19)', () => {
  const owner = {
    ...baseEmployee,
    profileId: 'p-owner',
    firstName: 'Marta',
    lastName: 'Dueña',
    roles: ['owner', 'employee'],
  }

  it('un administrador con manage_users ve la ficha y «Editar», sin baja, contraseña, cierre de sesiones ni cambio de roles', () => {
    authState.current = {
      roles: ['admin'],
      capabilities: ['manage_users'],
      userId: 'u-admin',
    }
    employeeState.current = owner
    renderPage()
    expect(
      screen.getByRole('heading', { name: 'Marta Dueña' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Editar' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Dar de baja' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Cambiar contraseña' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Cerrar sesiones' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Editar roles' }),
    ).not.toBeInTheDocument()
  })

  it('el mismo administrador sí ve la baja y los roles de un empleado común', () => {
    authState.current = {
      roles: ['admin'],
      capabilities: ['manage_users'],
      userId: 'u-admin',
    }
    renderPage()
    expect(
      screen.getByRole('button', { name: 'Dar de baja' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Editar roles' }),
    ).toBeInTheDocument()
  })

  it('el dueño puede todo sobre la ficha de otro dueño', () => {
    employeeState.current = owner
    renderPage()
    expect(
      screen.getByRole('button', { name: 'Dar de baja' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Editar roles' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Editar' })).toBeInTheDocument()
  })
})
