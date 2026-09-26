import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChecklistItemsEditor } from './ChecklistItemsEditor'
import type { ChecklistTemplateItem } from '@/api/checklists'

/**
 * TASK-005: mismo patrón que `AdminTaskList.test.tsx` -- se mockean los
 * hooks de datos y mutación (sin red, sin `QueryClientProvider`).
 */
const ITEMS: ChecklistTemplateItem[] = [
  {
    id: 'i1',
    templateId: 't1',
    position: 0,
    title: 'Barrer el salón',
    description: null,
    isRequired: true,
  },
  {
    id: 'i2',
    templateId: 't1',
    position: 1,
    title: 'Vaciar cestos',
    description: null,
    isRequired: false,
  },
]

const { reorderMock, deactivateMock } = vi.hoisted(() => ({
  reorderMock: vi.fn().mockResolvedValue(undefined),
  deactivateMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ userId: 'admin-1', roles: ['owner'], capabilities: [] }),
}))

vi.mock('@/features/checklists/queries', () => ({
  useChecklistItemsQuery: () => ({ data: ITEMS, isLoading: false }),
  useReorderTemplateItemsMutation: () => ({
    mutateAsync: reorderMock,
    isPending: false,
  }),
  useDeactivateTemplateItemMutation: () => ({
    mutateAsync: deactivateMock,
    isPending: false,
  }),
  useCreateTemplateItemMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useUpdateTemplateItemMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

describe('ChecklistItemsEditor', () => {
  it('de solo lectura (sin edit_checklists), no muestra ninguna acción', () => {
    render(<ChecklistItemsEditor templateId="t1" canEdit={false} />)
    expect(screen.getByText('Barrer el salón')).toBeInTheDocument()
    expect(screen.getByText('Vaciar cestos')).toBeInTheDocument()
    expect(screen.getByText('Opcional')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /agregar ítem/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /subir/i }),
    ).not.toBeInTheDocument()
  })

  it('con permiso, "Subir" en el primer ítem está deshabilitado y en el segundo reordena', () => {
    render(<ChecklistItemsEditor templateId="t1" canEdit />)

    const upButtons = screen.getAllByRole('button', { name: /subir/i })
    expect(upButtons[0]).toBeDisabled()

    fireEvent.click(upButtons[1] as HTMLElement)
    expect(reorderMock).toHaveBeenCalledWith({
      items: [ITEMS[1], ITEMS[0]],
      updatedBy: 'admin-1',
    })
  })

  it('con permiso, dar de baja pide confirmación antes de llamar a la mutación', () => {
    render(<ChecklistItemsEditor templateId="t1" canEdit />)

    fireEvent.click(
      screen.getByRole('button', { name: /dar de baja "barrer el salón"/i }),
    )
    expect(deactivateMock).not.toHaveBeenCalled()
    expect(
      screen.getByRole('heading', { name: /dar de baja este ítem/i }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja' }))
    expect(deactivateMock).toHaveBeenCalledWith({
      id: 'i1',
      updatedBy: 'admin-1',
    })
  })
})
