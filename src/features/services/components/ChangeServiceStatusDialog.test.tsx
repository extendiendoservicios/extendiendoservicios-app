import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'
import { ChangeServiceStatusDialog } from './ChangeServiceStatusDialog'

/**
 * D-03 (P31.3): al pausar o finalizar, la dirección elimina los turnos
 * futuros sin historia (casilla marcada, desde mañana); el administrador ve
 * cuántos quedan.
 */

const { auth, setStatus, ownerDelete, remaining, toastApi } = vi.hoisted(
  () => ({
    auth: { roles: ['owner'] as string[], capabilities: [] as string[] },
    setStatus: vi.fn(),
    ownerDelete: vi.fn(),
    remaining: { data: 0 },
    toastApi: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  }),
)

vi.mock('sonner', () => ({ toast: toastApi }))
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ ...auth, userId: 'u1' }),
}))
vi.mock('@/features/services/queries', () => ({
  useSetServiceStatusMutation: () => ({
    mutateAsync: setStatus,
    isPending: false,
  }),
  useServiceShiftsFromCountQuery: (
    _serviceId: string,
    _from: string,
    enabled: boolean,
  ) => ({ data: enabled ? remaining.data : undefined }),
}))
vi.mock('@/features/ownerDelete/queries', () => ({
  useOwnerDeleteMutation: () => ({
    mutateAsync: ownerDelete,
    isPending: false,
  }),
}))
vi.mock('./GenerateServiceShiftsDialog', () => ({
  GenerateServiceShiftsDialog: () => <div data-testid="generar" />,
}))
vi.mock('@/features/employees/employeeLeaveStatus', () => ({
  todayInBuenosAires: () => '2026-11-23',
}))
vi.mock('@/components/DatePicker', () => ({
  DatePicker: ({ value }: { value?: Date }) => (
    <span data-testid="fecha-desde">{value ? value.toDateString() : ''}</span>
  ),
}))

const service = { id: 'sv1', name: 'RAESA OFICINA', status: 'active' as const }

function renderDialog() {
  const onOpenChange = vi.fn()
  render(
    <ChangeServiceStatusDialog
      service={service}
      open
      onOpenChange={onOpenChange}
    />,
  )
  return onOpenChange
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.roles = ['owner']
  remaining.data = 0
  setStatus.mockResolvedValue({ id: 'sv1', validFrom: null })
  ownerDelete.mockResolvedValue({
    entity: 'service_shifts',
    id: 'sv1',
    name: 'RAESA OFICINA',
    deleted: { shifts: 12 },
    skippedCount: 2,
  })
})

describe('ChangeServiceStatusDialog: la dirección (D-03)', () => {
  it('ofrece la casilla marcada por defecto con la fecha de mañana', () => {
    renderDialog()
    const box = screen.getByRole('checkbox', {
      name: /Eliminar los turnos de este servicio desde/,
    })
    expect(box).toBeChecked()
    expect(box.closest('label')).toHaveTextContent(/24 nov/)
    expect(screen.getByTestId('fecha-desde')).toHaveTextContent(
      'Tue Nov 24 2026',
    )
  })

  it('los textos de efecto dicen que se eliminan los turnos, no que no se tocan', () => {
    renderDialog()
    expect(
      screen.getByText(/Se eliminan los turnos sin historia/),
    ).toBeVisible()
    expect(screen.queryByText(/no se tocan/)).toBeNull()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByText(/quedan como están/)).toBeVisible()
  })

  it('al confirmar cambia el estado y después elimina los turnos con el nombre del servicio', async () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar estado' }))
    await waitFor(() => expect(ownerDelete).toHaveBeenCalledTimes(1))
    expect(setStatus).toHaveBeenCalledWith({
      id: 'sv1',
      status: 'paused',
      updatedBy: 'u1',
    })
    expect(ownerDelete).toHaveBeenCalledWith({
      kind: 'service_shifts',
      id: 'sv1',
      confirmName: 'RAESA OFICINA',
      fromDate: '2026-11-24',
    })
    expect(setStatus.mock.invocationCallOrder[0]).toBeLessThan(
      ownerDelete.mock.invocationCallOrder[0] as number,
    )
    await waitFor(() =>
      expect(toastApi.success).toHaveBeenCalledWith(
        'Eliminamos 12 turnos. Quedaron 2 turnos por tener historia.',
      ),
    )
  })

  it('con la casilla desmarcada solo cambia el estado', async () => {
    renderDialog()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar estado' }))
    await waitFor(() => expect(setStatus).toHaveBeenCalled())
    expect(ownerDelete).not.toHaveBeenCalled()
  })

  it('si falla la eliminación avisa con el mensaje del servidor y el estado ya quedó cambiado', async () => {
    ownerDelete.mockRejectedValue(
      new ApiError('No pudimos borrar.', 'CONFIRM_NAME_MISMATCH'),
    )
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar estado' }))
    await waitFor(() => expect(toastApi.error).toHaveBeenCalled())
    expect(toastApi.error.mock.calls[0]?.[0]).toContain('No pudimos borrar.')
    expect(setStatus).toHaveBeenCalled()
  })
})

describe('ChangeServiceStatusDialog: un administrador (D-03)', () => {
  beforeEach(() => {
    auth.roles = ['admin']
  })

  it('en lugar de la casilla ve cuántos turnos futuros quedan', () => {
    remaining.data = 15
    renderDialog()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(
      screen.getByText(
        'Quedan 15 turnos futuros. La dirección puede eliminarlos.',
      ),
    ).toBeVisible()
  })

  it('sin turnos futuros no muestra el aviso', () => {
    remaining.data = 0
    renderDialog()
    expect(screen.queryByText(/turnos? futuros?/)).toBeNull()
  })

  it('al confirmar solo cambia el estado: nunca llama a eliminar', async () => {
    remaining.data = 3
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar estado' }))
    await waitFor(() => expect(setStatus).toHaveBeenCalled())
    expect(ownerDelete).not.toHaveBeenCalled()
  })
})
