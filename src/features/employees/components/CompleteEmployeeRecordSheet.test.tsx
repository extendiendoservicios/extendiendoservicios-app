import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** P26.8 (CR-18): «Completar ficha laboral» llama a `add_employee_record` e invalida Usuarios y Empleados. */

const { addEmployeeRecordMock, toastSuccess, toastError } = vi.hoisted(() => ({
  addEmployeeRecordMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}))

vi.mock('@/api/employees', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/employees')>()),
  addEmployeeRecord: addEmployeeRecordMock,
  fetchSuggestedEmployeeNumber: () => Promise.resolve(14),
}))

const { CompleteEmployeeRecordSheet } =
  await import('./CompleteEmployeeRecordSheet')

function renderSheet() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  render(
    <QueryClientProvider client={queryClient}>
      <CompleteEmployeeRecordSheet
        profileId="p1"
        fullName="Marta Dueña"
        open
        onOpenChange={vi.fn()}
      />
    </QueryClientProvider>,
  )
  return { invalidate }
}

function type(id: string, value: string) {
  fireEvent.change(document.getElementById(id) as HTMLInputElement, {
    target: { value },
  })
}

beforeEach(() => {
  addEmployeeRecordMock.mockReset().mockResolvedValue(undefined)
  toastSuccess.mockReset()
  toastError.mockReset()
})

describe('CompleteEmployeeRecordSheet', () => {
  it('exige el DNI antes de llamar al servidor', async () => {
    renderSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Completar ficha' }))
    expect(await screen.findByText('Falta el DNI.')).toBeInTheDocument()
    expect(addEmployeeRecordMock).not.toHaveBeenCalled()
  })

  it('guarda la ficha, invalida Usuarios y Empleados y avisa «Ya figura en Empleados»', async () => {
    const { invalidate } = renderSheet()
    type('complete-record-dni', '20111222')
    await waitFor(() =>
      expect(
        (document.getElementById('complete-record-number') as HTMLInputElement)
          .value,
      ).toBe('14'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Completar ficha' }))

    await waitFor(() => expect(addEmployeeRecordMock).toHaveBeenCalledTimes(1))
    expect(addEmployeeRecordMock).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ dni: '20111222', employeeNumber: 14 }),
    )
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        'Ya figura en Empleados: Marta Dueña.',
      ),
    )
    const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey?.[0])
    expect(keys).toContain('employees')
    expect(keys).toContain('users')
  })

  it('muestra el mensaje del servidor si el legajo ya está en uso', async () => {
    const { ApiError } = await import('@/api/errors')
    addEmployeeRecordMock.mockRejectedValue(
      new ApiError('Ese legajo ya está en uso.', 'EMPLOYEE_NUMBER_IN_USE'),
    )
    renderSheet()
    type('complete-record-dni', '20111222')
    type('complete-record-number', '3')
    fireEvent.click(screen.getByRole('button', { name: 'Completar ficha' }))
    expect(
      await screen.findByText('Ese legajo ya está en uso.'),
    ).toBeInTheDocument()
    expect(toastError).toHaveBeenCalledWith('Ese legajo ya está en uso.')
  })
})
