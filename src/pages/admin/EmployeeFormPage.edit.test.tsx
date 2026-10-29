import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * P26.8 (CR-19): en «Editar» de un dueño o administrador, un administrador ve
 * nombre, teléfono y email de contacto de solo lectura y `updateEmployee` no
 * toca `profiles`; el dueño edita todo.
 */

const { authState, detailState, updateEmployeeMock } = vi.hoisted(() => ({
  authState: {
    current: {
      userId: 'u-admin',
      roles: ['admin'] as string[],
      capabilities: ['manage_users'] as string[],
    },
  },
  detailState: { roles: ['owner', 'employee'] as string[] },
  updateEmployeeMock: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => authState.current,
}))

vi.mock('@/api/employees', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/employees')>()),
  fetchEmployeeDetail: () =>
    Promise.resolve({
      profileId: 'p-owner',
      firstName: 'Marta',
      lastName: 'Dueña',
      employeeNumber: 1,
      roles: detailState.roles,
      status: 'active',
      effectiveStatus: 'active',
      isActiveAccount: true,
      deletedAt: null,
      avatarPath: null,
      dni: '20111222',
      cuil: null,
      address: null,
      birthDate: null,
      hireDate: null,
      terminatedAt: null,
      phone: '1155550000',
      contactEmail: 'marta@ejemplo.com',
      emergencyContactName: null,
      emergencyContactPhone: null,
      emergencyContactRelationship: null,
      notes: null,
    }),
  updateEmployee: updateEmployeeMock,
}))

vi.mock('@/features/bank/queries', () => ({
  useEmployeeBankDetailsQuery: () => ({
    isLoading: false,
    isError: false,
    data: null,
  }),
  useSetEmployeeBankDetailsMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

vi.mock('@/components/AvatarUpload', () => ({ AvatarUpload: () => null }))

const { default: EmployeeFormPage } = await import('./EmployeeFormPage')

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/empleados/p-owner/editar']}>
        <Routes>
          <Route
            path="/admin/empleados/:id/editar"
            element={<EmployeeFormPage />}
          />
          <Route path="/admin/empleados/:id" element={<p>Ficha abierta</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function waitForForm() {
  return screen.findByLabelText('Nombre', { selector: '#employee-first-name' })
}

beforeEach(() => {
  updateEmployeeMock.mockReset().mockResolvedValue({ profileId: 'p-owner' })
  authState.current = {
    userId: 'u-admin',
    roles: ['admin'],
    capabilities: ['manage_users'],
  }
  detailState.roles = ['owner', 'employee']
})

describe('EmployeeFormPage · edición de un dueño o administrador (CR-19)', () => {
  it('un administrador ve nombre, apellido, teléfono y email de contacto de solo lectura, con la ayuda', async () => {
    renderPage()
    expect(await waitForForm()).toHaveAttribute('readonly')
    expect(document.getElementById('employee-last-name')).toHaveAttribute(
      'readonly',
    )
    expect(document.getElementById('employee-phone')).toHaveAttribute(
      'readonly',
    )
    expect(document.getElementById('employee-contact-email')).toHaveAttribute(
      'readonly',
    )
    expect(
      screen.getAllByText('Solo el dueño puede cambiar estos datos.').length,
    ).toBeGreaterThan(0)
    // Los datos laborales siguen editables.
    expect(document.getElementById('employee-dni')).not.toHaveAttribute(
      'readonly',
    )
  })

  it('al guardar manda updateProfile en false y los datos laborales cambiados', async () => {
    renderPage()
    await waitForForm()
    fireEvent.change(
      document.getElementById('employee-address') as HTMLInputElement,
      { target: { value: 'Calle 123' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(updateEmployeeMock).toHaveBeenCalledTimes(1))
    const [profileId, input, , options] = (updateEmployeeMock.mock.calls[0] ??
      []) as [string, { address: string }, string, unknown]
    expect(profileId).toBe('p-owner')
    expect(input.address).toBe('Calle 123')
    expect(options).toEqual({ updateProfile: false })
  })

  it('el dueño edita todo y sí actualiza el perfil', async () => {
    authState.current = {
      userId: 'u-owner',
      roles: ['owner'],
      capabilities: [],
    }
    renderPage()
    expect(await waitForForm()).not.toHaveAttribute('readonly')
    expect(
      screen.queryByText('Solo el dueño puede cambiar estos datos.'),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(updateEmployeeMock).toHaveBeenCalledTimes(1))
    expect(updateEmployeeMock.mock.calls[0]?.[3]).toEqual({
      updateProfile: true,
    })
  })

  it('un administrador sigue editando todo el perfil de un empleado común', async () => {
    detailState.roles = ['employee']
    renderPage()
    expect(await waitForForm()).not.toHaveAttribute('readonly')
  })
})
