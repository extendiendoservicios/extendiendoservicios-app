import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * P26.8 (CR-17): el alta de un usuario administrativo pide la ficha laboral
 * completa y la manda en la misma llamada de creación.
 */

const { createAdminUserMock, toastSuccess, toastError } = vi.hoisted(() => ({
  createAdminUserMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}))

vi.mock('@/api/users', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/users')>()),
  createAdminUser: createAdminUserMock,
}))

vi.mock('@/api/employees', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/employees')>()),
  fetchSuggestedEmployeeNumber: () => Promise.resolve(8),
}))

const { NewAdminUserSheet } = await import('./NewAdminUserSheet')

function renderSheet() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <NewAdminUserSheet open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  )
}

function type(id: string, value: string) {
  fireEvent.change(document.getElementById(id) as HTMLInputElement, {
    target: { value },
  })
}

function fillAccount() {
  type('new-admin-first-name', 'Ana')
  type('new-admin-last-name', 'Gómez')
  type('new-admin-email', 'ana@ejemplo.com')
  type('new-admin-password', 'clave-segura-1')
}

beforeEach(() => {
  createAdminUserMock
    .mockReset()
    .mockResolvedValue({ profileId: 'nuevo', employeeNumber: 8 })
  toastSuccess.mockReset()
  toastError.mockReset()
})

describe('NewAdminUserSheet · ficha laboral (CR-17)', () => {
  it('muestra los campos de la ficha laboral', () => {
    renderSheet()
    expect(screen.getByLabelText('DNI')).toBeInTheDocument()
    expect(screen.getByLabelText('CUIL')).toBeInTheDocument()
    expect(screen.getByLabelText('Legajo')).toBeInTheDocument()
    expect(screen.getByLabelText('Fecha de ingreso')).toBeInTheDocument()
  })

  it('sin DNI no crea la cuenta y marca el campo', async () => {
    renderSheet()
    fillAccount()
    fireEvent.click(screen.getByRole('button', { name: 'Crear administrador' }))

    expect(await screen.findByText('Falta el DNI.')).toBeInTheDocument()
    expect(createAdminUserMock).not.toHaveBeenCalled()
  })

  it('con la ficha completa manda rol admin y la ficha en una sola llamada', async () => {
    renderSheet()
    fillAccount()
    type('new-admin-dni', '30.123.456')
    await waitFor(() =>
      expect(
        (document.getElementById('new-admin-number') as HTMLInputElement).value,
      ).toBe('8'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Crear administrador' }))

    await waitFor(() => expect(createAdminUserMock).toHaveBeenCalledTimes(1))
    expect(createAdminUserMock.mock.calls[0]?.[0]).toMatchObject({
      roles: ['admin'],
      email: 'ana@ejemplo.com',
      employee: { dni: '30123456', employeeNumber: 8 },
    })
  })

  it('si el servidor devuelve DNI repetido lo marca en el campo', async () => {
    const { ApiError } = await import('@/api/errors')
    createAdminUserMock.mockRejectedValue(
      new ApiError('Ese DNI ya está registrado.', 'DNI_IN_USE'),
    )
    renderSheet()
    fillAccount()
    type('new-admin-dni', '30123456')
    type('new-admin-number', '9')
    fireEvent.click(screen.getByRole('button', { name: 'Crear administrador' }))

    expect(
      await screen.findByText('Ese DNI ya está registrado.'),
    ).toBeInTheDocument()
    expect(toastError).toHaveBeenCalledWith('Ese DNI ya está registrado.')
  })
})
