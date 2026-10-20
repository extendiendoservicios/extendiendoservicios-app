import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EmployeeLeavesTab } from './EmployeeLeavesTab'

const { updateMutateAsync, createMutateAsync, conflictsMutateAsync } =
  vi.hoisted(() => ({
    updateMutateAsync: vi.fn(),
    createMutateAsync: vi.fn(),
    conflictsMutateAsync: vi.fn(),
  }))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ userId: 'admin-1', roles: ['admin'], capabilities: [] }),
}))

vi.mock('@/features/employees/queries', () => ({
  useEmployeeLeavesQuery: () => ({
    isLoading: false,
    data: [
      {
        id: 'l1',
        startsOn: '2026-11-02',
        endsOn: '2026-11-10',
        reason: 'Vacaciones',
        deletedAt: null,
      },
      {
        id: 'l2',
        startsOn: '2026-01-02',
        endsOn: '2026-01-05',
        reason: null,
        deletedAt: '2026-01-03T10:00:00Z',
      },
    ],
  }),
  useCreateEmployeeLeaveMutation: () => ({
    mutateAsync: createMutateAsync,
    isPending: false,
  }),
  useUpdateEmployeeLeaveMutation: () => ({
    mutateAsync: updateMutateAsync,
    isPending: false,
  }),
  useLeaveConflictsMutation: () => ({
    mutateAsync: conflictsMutateAsync,
    isPending: false,
  }),
  useDeactivateEmployeeLeaveMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

beforeEach(() => {
  updateMutateAsync.mockReset().mockResolvedValue(undefined)
  createMutateAsync.mockReset()
  conflictsMutateAsync.mockReset().mockResolvedValue([])
})

describe('EmployeeLeavesTab: editar licencia (AJ2-08)', () => {
  it('solo ofrece Editar en las licencias activas', () => {
    render(<EmployeeLeavesTab profileId="e1" canEdit />)
    expect(
      screen.getAllByRole('button', { name: /editar la licencia/i }),
    ).toHaveLength(1)
  })

  it('no ofrece Editar sin permiso', () => {
    render(<EmployeeLeavesTab profileId="e1" canEdit={false} />)
    expect(
      screen.queryByRole('button', { name: /editar la licencia/i }),
    ).toBeNull()
  })

  it('carga el formulario con los datos y guarda con update, no con alta', async () => {
    render(<EmployeeLeavesTab profileId="e1" canEdit />)
    fireEvent.click(screen.getByRole('button', { name: /editar la licencia/i }))
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-11-02')
    expect(screen.getByLabelText('Hasta (opcional)')).toHaveValue('2026-11-10')
    expect(screen.getByLabelText('Motivo (opcional)')).toHaveValue('Vacaciones')

    fireEvent.change(screen.getByLabelText('Hasta (opcional)'), {
      target: { value: '2026-11-12' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1))
    expect(updateMutateAsync).toHaveBeenCalledWith({
      id: 'l1',
      input: {
        startsOn: '2026-11-02',
        endsOn: '2026-11-12',
        reason: 'Vacaciones',
      },
      updatedBy: 'admin-1',
    })
    expect(createMutateAsync).not.toHaveBeenCalled()
  })

  it('cancelar la edición vuelve al formulario de alta vacío', () => {
    render(<EmployeeLeavesTab profileId="e1" canEdit />)
    fireEvent.click(screen.getByRole('button', { name: /editar la licencia/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar edición' }))
    expect(
      screen.getByRole('button', { name: 'Agregar licencia' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Desde')).toHaveValue('')
  })
})

describe('EmployeeLeavesTab: turnos asignados dentro de la licencia (P19.11d)', () => {
  it('al guardar una licencia nueva con turnos asignados, los lista con enlace al turno', async () => {
    createMutateAsync.mockResolvedValue(undefined)
    conflictsMutateAsync.mockResolvedValue([
      {
        assignmentId: 'as1',
        shiftId: 'sh1',
        shiftDate: '2026-11-04',
        startTime: '08:00:00',
        endTime: '12:00:00',
        openEnded: false,
        clientName: 'Limpia Ya',
        siteName: 'Sede Centro',
        shiftStatus: 'assigned',
      },
    ])
    render(
      <MemoryRouter>
        <EmployeeLeavesTab profileId="e1" canEdit />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText('Desde'), {
      target: { value: '2026-11-03' },
    })
    fireEvent.change(screen.getByLabelText('Hasta (opcional)'), {
      target: { value: '2026-11-06' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar licencia' }))

    await waitFor(() =>
      expect(conflictsMutateAsync).toHaveBeenCalledWith({
        startsOn: '2026-11-03',
        endsOn: '2026-11-06',
      }),
    )
    expect(
      await screen.findByText(/Esta persona tiene 1 turno asignado/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Limpia Ya · Sede Centro/)).toBeInTheDocument()
    expect(screen.getByText('08:00–12:00')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir turno' })).toHaveAttribute(
      'href',
      '/admin/turnos/sh1',
    )
  })

  it('sin turnos asignados no muestra ningún aviso', async () => {
    createMutateAsync.mockResolvedValue(undefined)
    render(
      <MemoryRouter>
        <EmployeeLeavesTab profileId="e1" canEdit />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText('Desde'), {
      target: { value: '2026-12-03' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar licencia' }))
    await waitFor(() => expect(conflictsMutateAsync).toHaveBeenCalled())
    expect(screen.queryByText(/turno asignado/)).toBeNull()
  })
})
