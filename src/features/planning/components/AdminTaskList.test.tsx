import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AdminTaskList } from './AdminTaskList'
import type { ShiftDetailTask } from '@/api/assignments'

/**
 * TASK-006: mismo patrón que `UserActionsMenu.test.tsx` -- se mockea el
 * hook de mutación (sin red, sin `QueryClientProvider`). `not_done` no
 * llama a la mutación directo: abre el `ConfirmDialog` con motivo
 * obligatorio (el botón de confirmar sale deshabilitado hasta escribir
 * algo, `ConfirmDialog.test.tsx` ya prueba ese detalle).
 *
 * `scrollIntoView`: jsdom no lo implementa y Radix `Select` lo llama al
 * abrir el listado de opciones -- mismo tipo de polyfill mínimo que
 * `ResizeObserver` en `src/test/setup.ts`, pero local a este archivo
 * porque es el primero de la capa de administración que monta un `Select`
 * de Radix en un test.
 */
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {}
}
const { mutateAsyncMock } = vi.hoisted(() => ({
  mutateAsyncMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/features/planning/queries', () => ({
  useUpdateTaskStatusMutation: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }),
}))

function makeTask(overrides: Partial<ShiftDetailTask> = {}): ShiftDetailTask {
  return {
    id: 't1',
    title: 'Barrer el salón',
    description: null,
    isRequired: true,
    status: 'pending',
    position: 0,
    notDoneReason: null,
    ...overrides,
  }
}

describe('AdminTaskList', () => {
  it('de solo lectura, muestra el estado con StatusBadge y no ofrece cambiarlo', () => {
    render(<AdminTaskList tasks={[makeTask()]} canManage={false} />)
    expect(screen.getByText('Pendiente')).toBeInTheDocument()
    expect(
      screen.queryByRole('combobox', { name: /estado de/i }),
    ).not.toBeInTheDocument()
  })

  it('con permiso, cambiar a "Realizada" llama a la mutación sin pedir motivo', () => {
    render(<AdminTaskList tasks={[makeTask()]} canManage />)
    fireEvent.click(
      screen.getByRole('combobox', { name: /estado de "barrer el salón"/i }),
    )
    fireEvent.click(screen.getByRole('option', { name: 'Realizada' }))
    expect(mutateAsyncMock).toHaveBeenCalledWith({
      taskId: 't1',
      status: 'done',
    })
  })

  it('con permiso, elegir "No realizada" abre el diálogo de motivo en vez de llamar directo a la mutación', () => {
    render(<AdminTaskList tasks={[makeTask()]} canManage />)
    fireEvent.click(
      screen.getByRole('combobox', { name: /estado de "barrer el salón"/i }),
    )
    fireEvent.click(screen.getByRole('option', { name: 'No realizada' }))

    expect(mutateAsyncMock).not.toHaveBeenCalled()
    expect(
      screen.getByRole('heading', {
        name: /marcar "barrer el salón" como no realizada/i,
      }),
    ).toBeInTheDocument()

    const confirmButton = screen.getByRole('button', {
      name: 'Marcar no realizada',
    })
    expect(confirmButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Motivo'), {
      target: { value: 'Faltó un insumo' },
    })
    expect(confirmButton).toBeEnabled()
    fireEvent.click(confirmButton)

    expect(mutateAsyncMock).toHaveBeenCalledWith({
      taskId: 't1',
      status: 'not_done',
      reason: 'Faltó un insumo',
    })
  })

  it('muestra el motivo cuando la tarea ya está marcada como no realizada', () => {
    render(
      <AdminTaskList
        tasks={[makeTask({ status: 'not_done', notDoneReason: 'Sin insumos' })]}
        canManage
      />,
    )
    expect(screen.getByText('Motivo: Sin insumos')).toBeInTheDocument()
  })
})
