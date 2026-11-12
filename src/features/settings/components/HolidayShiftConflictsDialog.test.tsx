import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HolidayShiftConflicts } from '@/api/settings'
import {
  describeRemovedHolidayShifts,
  HolidayShiftConflictsDialog,
} from './HolidayShiftConflictsDialog'

const { authState, removeMock, toastMock } = vi.hoisted(() => ({
  authState: { roles: ['owner'] as string[], capabilities: [] as string[] },
  removeMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => authState }))
vi.mock('@/features/settings/queries', () => ({
  useRemoveHolidayShiftsMutation: () => ({
    mutateAsync: removeMock,
    isPending: false,
  }),
}))

const CONFLICTS: HolidayShiftConflicts = {
  date: '2026-11-11',
  isHoliday: true,
  deletableCount: 2,
  withHistoryCount: 1,
  shifts: [
    {
      shiftId: 's1',
      shiftDate: '2026-11-11',
      startTime: '08:00:00',
      endTime: '12:00:00',
      status: 'assigned',
      serviceId: 'sv1',
      serviceName: 'Limpieza diaria',
      clientName: 'Cliente Uno',
      siteName: 'Sede Norte',
      assignmentsCount: 1,
      hasHistory: false,
    },
  ],
}

beforeEach(() => {
  authState.roles = ['owner']
  authState.capabilities = []
  removeMock.mockReset()
  removeMock.mockResolvedValue({ deletedShifts: 2, skippedCount: 1 })
  toastMock.success.mockReset()
  toastMock.error.mockReset()
})

describe('HolidayShiftConflictsDialog (OF-19b)', () => {
  it('ofrece eliminar los turnos y llama a remove_holiday_shifts', async () => {
    const onOpenChange = vi.fn()
    render(
      <HolidayShiftConflictsDialog
        conflicts={CONFLICTS}
        onOpenChange={onOpenChange}
      />,
    )
    expect(
      screen.getByText(
        'Hay 2 turnos ese día de servicios que no trabajan feriados. ¿Eliminarlos?',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Limpieza diaria')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar los turnos' }))
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('2026-11-11'))
    expect(toastMock.success).toHaveBeenCalledWith(
      'Eliminamos 2 turnos. Salteamos 1 turno que tiene historia.',
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('un administrador sin cancel_shifts ve la lista pero no el botón', () => {
    authState.roles = ['admin']
    authState.capabilities = ['manage_stock']
    render(
      <HolidayShiftConflictsDialog
        conflicts={CONFLICTS}
        onOpenChange={vi.fn()}
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'Eliminar los turnos' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Limpieza diaria')).toBeInTheDocument()
  })

  it('un administrador con cancel_shifts puede eliminarlos', () => {
    authState.roles = ['admin']
    authState.capabilities = ['cancel_shifts']
    render(
      <HolidayShiftConflictsDialog
        conflicts={CONFLICTS}
        onOpenChange={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Eliminar los turnos' }),
    ).toBeInTheDocument()
  })

  it('informa lo borrado y lo salteado', () => {
    expect(
      describeRemovedHolidayShifts({ deletedShifts: 1, skippedCount: 0 }),
    ).toBe('Eliminamos 1 turno.')
    expect(
      describeRemovedHolidayShifts({ deletedShifts: 3, skippedCount: 2 }),
    ).toBe('Eliminamos 3 turnos. Salteamos 2 turnos que tienen historia.')
  })
})
