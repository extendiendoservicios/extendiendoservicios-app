import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EmployeeLeavesTab } from './EmployeeLeavesTab'

const { updateMutateAsync, createMutateAsync } = vi.hoisted(() => ({
  updateMutateAsync: vi.fn(),
  createMutateAsync: vi.fn(),
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
  useDeactivateEmployeeLeaveMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

beforeEach(() => {
  updateMutateAsync.mockReset().mockResolvedValue(undefined)
  createMutateAsync.mockReset()
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
